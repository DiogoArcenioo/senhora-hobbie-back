import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { VendasGestaoService } from './vendas-gestao.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('admin/vendas')
export class VendasGestaoController {
  constructor(private readonly vendasGestaoService: VendasGestaoService) {}

  @Get()
  getDashboard(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.vendasGestaoService.getDashboard(userId);
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!userId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId;
  }
}
