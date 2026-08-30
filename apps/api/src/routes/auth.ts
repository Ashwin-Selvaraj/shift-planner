import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Role } from '@shift-planner/core';
import { asyncHandler, unauthorized } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { permissionsFor } from '../lib/permissions.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = credentials.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { employee: true },
    });

    // The same message and comparable timing for both failure modes, so the
    // endpoint cannot be used to enumerate which addresses have accounts.
    const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    const matches = await bcrypt.compare(password, hash);

    if (!user || !matches || !user.isActive) {
      throw unauthorized('Incorrect email or password');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const role = user.role as Role;
    const token = signToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role,
      employeeId: user.employee?.id ?? null,
      teamId: user.employee?.teamId ?? null,
    });

    await recordAudit(
      { id: user.id, email: user.email, name: user.name, role },
      { action: 'SIGN_IN', entity: 'User', entityId: user.id },
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role,
        employeeId: user.employee?.id ?? null,
        teamId: user.employee?.teamId ?? null,
        permissions: permissionsFor(role),
      },
    });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    res.json({ ...user, permissions: permissionsFor(user.role) });
  }),
);
