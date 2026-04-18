import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

type AuthenticatedUser = {
  userId?: string;
  tipo?: string;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    const userId = typeof user?.userId === 'string' ? user.userId.trim() : '';

    if (!userId) {
      throw new ForbiddenException('Usuario nao autenticado');
    }

    const usuario = await this.usuariosRepository.findOne({
      where: { id: userId },
    });

    if (!usuario || !usuario.ativo) {
      throw new ForbiddenException('Acesso negado');
    }

    const tipoNormalizado =
      typeof usuario.tipo === 'string' ? usuario.tipo.trim().toUpperCase() : '';
    const rolesNormalizados = requiredRoles.map((role) =>
      role.trim().toUpperCase(),
    );

    if (!rolesNormalizados.includes(tipoNormalizado)) {
      throw new ForbiddenException('Acesso permitido apenas para admin');
    }

    return true;
  }
}
