import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AssinaturasGestaoService } from './assinaturas-gestao.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('admin/gestao-assinaturas')
export class AssinaturasGestaoController {
  constructor(
    private readonly assinaturasGestaoService: AssinaturasGestaoService,
  ) {}

  @Get()
  getDashboard(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.assinaturasGestaoService.getDashboard(userId);
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!userId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId;
  }
}
