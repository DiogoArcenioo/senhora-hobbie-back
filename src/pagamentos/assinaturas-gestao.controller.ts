import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AssinaturasGestaoService } from './assinaturas-gestao.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('admin/gestao-assinaturas')
@UseGuards(RolesGuard)
@Roles('ADM')
export class AssinaturasGestaoController {
  constructor(
    private readonly assinaturasGestaoService: AssinaturasGestaoService,
  ) {}

  @Get()
  getDashboard(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.assinaturasGestaoService.getDashboard(userId);
  }

  @Post(':id/sync')
  syncAssinatura(
    @Req() req: AuthenticatedRequest,
    @Param('id') assinaturaId: string,
  ) {
    const userId = this.getUserId(req);
    return this.assinaturasGestaoService.syncSubscription(userId, assinaturaId);
  }

  @Post(':id/cancelar')
  cancelAssinatura(
    @Req() req: AuthenticatedRequest,
    @Param('id') assinaturaId: string,
  ) {
    const userId = this.getUserId(req);
    return this.assinaturasGestaoService.cancelSubscription(
      userId,
      assinaturaId,
    );
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!userId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId;
  }
}
