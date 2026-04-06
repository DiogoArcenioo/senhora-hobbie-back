import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ConfirmarPagamentoDto } from './dto/confirmar-pagamento.dto';
import { CreateCheckoutProDto } from './dto/create-checkout-pro.dto';
import { CreateProductCheckoutDto } from './dto/create-product-checkout.dto';
import { PagamentosService } from './pagamentos.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    email: string;
  };
};

@Controller('pagamentos')
export class PagamentosController {
  constructor(private readonly pagamentosService: PagamentosService) {}

  @Post('checkout-pro')
  createCheckoutPro(
    @Body() body: CreateCheckoutProDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const planoId =
      typeof body?.planoId === 'string' ? body.planoId.trim() : '';
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';
    const userEmail = typeof req.user?.email === 'string' ? req.user.email : '';

    if (!planoId) {
      throw new BadRequestException('planoId e obrigatorio');
    }

    if (!userId || !userEmail) {
      throw new BadRequestException('Usuario autenticado invalido');
    }

    return this.pagamentosService.createCheckoutPro({
      planoId,
      userId,
      userEmail,
    });
  }

  @Post('assinaturas/plano-associado')
  createAssociatedPlanSubscription(
    @Body() body: CreateCheckoutProDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const planoId =
      typeof body?.planoId === 'string' ? body.planoId.trim() : '';
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';
    const userEmail = typeof req.user?.email === 'string' ? req.user.email : '';

    if (!planoId) {
      throw new BadRequestException('planoId e obrigatorio');
    }

    if (!userId || !userEmail) {
      throw new BadRequestException('Usuario autenticado invalido');
    }

    return this.pagamentosService.createAssociatedPlanSubscription({
      planoId,
      userId,
      userEmail,
    });
  }

  @Post('produtos/checkout-pro')
  createProductCheckout(
    @Body() body: CreateProductCheckoutDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const produtoId =
      typeof body?.produtoId === 'string' ? body.produtoId.trim() : '';
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';
    const userEmail = typeof req.user?.email === 'string' ? req.user.email : '';

    if (!produtoId) {
      throw new BadRequestException('produtoId e obrigatorio');
    }

    if (!userId || !userEmail) {
      throw new BadRequestException('Usuario autenticado invalido');
    }

    return this.pagamentosService.createProductCheckoutPro({
      produtoId,
      userId,
      userEmail,
    });
  }

  @Post('mercado-pago/confirmar')
  confirmMercadoPagoPayment(
    @Body() body: ConfirmarPagamentoDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const paymentId =
      typeof body?.paymentId === 'string' ? body.paymentId.trim() : '';
    const preapprovalId =
      typeof body?.preapprovalId === 'string' ? body.preapprovalId.trim() : '';
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!paymentId && !preapprovalId) {
      throw new BadRequestException('paymentId ou preapprovalId e obrigatorio');
    }

    if (!userId) {
      throw new BadRequestException('Usuario autenticado invalido');
    }

    if (preapprovalId) {
      return this.pagamentosService.confirmMercadoPagoSubscription(
        preapprovalId,
        userId,
      );
    }

    return this.pagamentosService.confirmMercadoPagoPayment(paymentId, userId);
  }

  @Public()
  @Post('mercado-pago/webhook')
  handleMercadoPagoWebhook(
    @Headers() headers: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
  ) {
    return this.pagamentosService.handleMercadoPagoWebhook({
      headers,
      query,
      body,
    });
  }
}
