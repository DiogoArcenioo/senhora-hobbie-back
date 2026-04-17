import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { VendasGestaoService } from './vendas-gestao.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
  };
};

type MarcarEnviadoDto = {
  codigoRastreio?: string | null;
  observacoes?: string | null;
};

@Controller('admin/vendas')
export class VendasGestaoController {
  constructor(private readonly vendasGestaoService: VendasGestaoService) {}

  @Get()
  getDashboard(
    @Req() req: AuthenticatedRequest,
    @Query('statusEnvio') statusEnvio?: string,
  ) {
    const userId = this.getUserId(req);
    return this.vendasGestaoService.getDashboard(userId, statusEnvio ?? null);
  }

  @Patch(':id/enviar')
  marcarEnviado(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: MarcarEnviadoDto,
  ) {
    const userId = this.getUserId(req);
    const vendaId = id?.trim();

    if (!vendaId) {
      throw new BadRequestException('id da venda e obrigatorio');
    }

    return this.vendasGestaoService.marcarEnviado(userId, vendaId, {
      codigoRastreio: body?.codigoRastreio ?? null,
      observacoes: body?.observacoes ?? null,
    });
  }

  @Patch(':id/entregar')
  marcarEntregue(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(req);
    const vendaId = id?.trim();

    if (!vendaId) {
      throw new BadRequestException('id da venda e obrigatorio');
    }

    return this.vendasGestaoService.marcarEntregue(userId, vendaId);
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!userId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId;
  }
}
