import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { Plano } from '../planos/entities/plano.entity';
import { PlanosService } from '../planos/planos.service';
import { Produto } from '../produtos/entities/produto.entity';
import { Assinatura } from './entities/assinatura.entity';
import { LogPagamento } from './entities/log-pagamento.entity';
import { Pagamento } from './entities/pagamento.entity';
import { WebhookPagamento } from './entities/webhook-pagamento.entity';

type MercadoPagoPreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
  message?: string;
  cause?: Array<{ description?: string }>;
};

type MercadoPagoPaymentResponse = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  payment_method_id?: string;
  installments?: number;
  description?: string;
  date_approved?: string;
  date_of_expiration?: string;
  external_reference?: string;
  metadata?: Record<string, unknown> | null;
};

type MercadoPagoPreapprovalPlanResponse = {
  id?: string;
  reason?: string;
  back_url?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    repetitions?: number | null;
    transaction_amount?: number;
    currency_id?: string;
  };
  message?: string;
  cause?: Array<{ description?: string }>;
};

type MercadoPagoPreapprovalResponse = {
  id?: string;
  preapproval_plan_id?: string;
  payer_id?: string | number;
  status?: string;
  reason?: string;
  external_reference?: string;
  init_point?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number;
    currency_id?: string;
    date_created?: string;
    next_payment_date?: string;
    end_date?: string;
  };
  date_created?: string;
  next_payment_date?: string;
  message?: string;
  cause?: Array<{ description?: string }>;
};

type MercadoPagoAutoRecurring = {
  frequency: number;
  frequency_type: 'days' | 'months';
  repetitions?: number;
  transaction_amount: number;
  currency_id: string;
};

type ParsedReference = {
  assinaturaId?: string;
  pagamentoId?: string;
  userId?: string;
  planoId?: string;
  produtoId?: string;
  preferenceId?: string;
};

type SyncResult = {
  pagamentoId: string;
  assinaturaId: string | null;
  usuarioId: string;
  paymentStatus: string;
};

type WebhookInput = {
  headers: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
};

type WebhookSignatureValidation = {
  enforced: boolean;
  isValid: boolean | null;
  reason: string | null;
};

@Injectable()
export class PagamentosService {
  constructor(
    private readonly configService: ConfigService,
    private readonly planosService: PlanosService,
    @InjectRepository(Produto)
    private readonly produtosRepository: Repository<Produto>,
    @InjectRepository(Assinatura)
    private readonly assinaturasRepository: Repository<Assinatura>,
    @InjectRepository(Pagamento)
    private readonly pagamentosRepository: Repository<Pagamento>,
    @InjectRepository(WebhookPagamento)
    private readonly webhooksRepository: Repository<WebhookPagamento>,
    @InjectRepository(LogPagamento)
    private readonly logsRepository: Repository<LogPagamento>,
  ) {}

  async createCheckoutPro(dto: {
    planoId: string;
    userId: string;
    userEmail: string;
  }) {
    const plano = await this.planosService.findOne(dto.planoId);

    if (!plano.ativo) {
      throw new BadRequestException('Plano inativo');
    }

    const accessToken = this.getMercadoPagoAccessToken();
    const unitPrice = Number(plano.valor);

    if (Number.isNaN(unitPrice) || unitPrice <= 0) {
      throw new InternalServerErrorException(
        'Valor do plano invalido para checkout',
      );
    }

    const assinatura = await this.assinaturasRepository.save(
      this.assinaturasRepository.create({
        usuario_id: dto.userId,
        plano_id: plano.id,
        status: 'PENDING_PAYMENT',
        gateway: 'MERCADO_PAGO',
        gateway_cliente_id: null,
        gateway_assinatura_id: null,
        renovacao_automatica: true,
        data_inicio: null,
        data_fim: null,
        proxima_cobranca_em: null,
        cancelado_em: null,
        observacoes: 'Checkout Pro iniciado',
      }),
    );

    let pagamento = await this.pagamentosRepository.save(
      this.pagamentosRepository.create({
        assinatura_id: assinatura.id,
        usuario_id: dto.userId,
        plano_id: plano.id,
        gateway: 'MERCADO_PAGO',
        gateway_pagamento_id: null,
        gateway_preferencia_id: null,
        gateway_checkout_id: null,
        status: 'PENDING',
        valor:
          typeof plano.valor === 'string' ? plano.valor : String(plano.valor),
        moeda: (plano.moeda || 'BRL').toUpperCase(),
        forma_pagamento: null,
        parcelas: null,
        descricao: `Assinatura ${plano.nome}`,
        motivo_recusa: null,
        detalhes_gateway: {
          etapa: 'preference_requested',
          planoId: plano.id,
        },
        data_pagamento: null,
        data_vencimento: null,
      }),
    );

    const externalReference = this.buildExternalReference({
      assinaturaId: assinatura.id,
      pagamentoId: pagamento.id,
      userId: dto.userId,
      planoId: plano.id,
    });

    try {
      const frontendUrl = this.getFrontendUrl();
      const webhookUrl = this.getWebhookUrl();

      const payload = {
        items: [
          {
            id: plano.id,
            title: plano.nome,
            description: plano.descricao ?? undefined,
            quantity: 1,
            unit_price: unitPrice,
            currency_id: this.normalizeCurrencyForMercadoPago(plano.moeda),
          },
        ],
        payer: {
          email: dto.userEmail,
        },
        external_reference: externalReference,
        metadata: {
          userId: dto.userId,
          planoId: plano.id,
          assinaturaId: assinatura.id,
          pagamentoId: pagamento.id,
        },
        back_urls: {
          success: `${frontendUrl}/assinatura/checkout/resultado?status=success`,
          failure: `${frontendUrl}/assinatura/checkout/resultado?status=failure`,
          pending: `${frontendUrl}/assinatura/checkout/resultado?status=pending`,
        },
        auto_return: 'approved',
        notification_url: webhookUrl,
      };

      const response = await fetch(
        'https://api.mercadopago.com/checkout/preferences',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify(payload),
        },
      );

      const responsePayload = (await response
        .json()
        .catch(() => null)) as MercadoPagoPreferenceResponse | null;

      if (!response.ok) {
        throw new BadGatewayException(
          this.resolveMercadoPagoError(
            responsePayload,
            'Nao foi possivel criar a preferencia de pagamento no Mercado Pago',
          ),
        );
      }

      const checkoutUrl =
        (typeof responsePayload?.init_point === 'string' &&
          responsePayload.init_point) ||
        (typeof responsePayload?.sandbox_init_point === 'string' &&
          responsePayload.sandbox_init_point) ||
        '';

      if (!checkoutUrl) {
        throw new BadGatewayException(
          'Mercado Pago nao retornou URL de checkout',
        );
      }

      pagamento.gateway_preferencia_id = responsePayload?.id ?? null;
      pagamento.gateway_checkout_id = responsePayload?.id ?? null;
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa: 'preference_created',
        preference_id: responsePayload?.id ?? null,
      };
      pagamento = await this.pagamentosRepository.save(pagamento);

      await this.createLog({
        nivel: 'INFO',
        evento: 'CHECKOUT_PRO_CRIADO',
        descricao: `Checkout Pro criado para pagamento ${pagamento.id}`,
        usuarioId: dto.userId,
        assinaturaId: assinatura.id,
        pagamentoId: pagamento.id,
        detalhes: {
          planoId: plano.id,
          preferenceId: responsePayload?.id ?? null,
        },
      });

      return {
        preference_id: responsePayload?.id ?? null,
        checkout_url: checkoutUrl,
        assinatura_id: assinatura.id,
        pagamento_id: pagamento.id,
      };
    } catch (error) {
      pagamento.status = 'FAILED';
      pagamento.motivo_recusa = this.normalizeErrorMessage(
        error,
        'Falha ao criar checkout no Mercado Pago',
      );
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa: 'preference_error',
        erro: pagamento.motivo_recusa,
      };
      await this.pagamentosRepository.save(pagamento);

      assinatura.status = 'CANCELLED';
      assinatura.cancelado_em = new Date();
      assinatura.observacoes = `Checkout cancelado por erro: ${pagamento.motivo_recusa}`;
      await this.assinaturasRepository.save(assinatura);

      await this.createLog({
        nivel: 'ERROR',
        evento: 'CHECKOUT_PRO_ERRO',
        descricao: `Falha ao criar checkout para pagamento ${pagamento.id}`,
        usuarioId: dto.userId,
        assinaturaId: assinatura.id,
        pagamentoId: pagamento.id,
        detalhes: {
          erro: pagamento.motivo_recusa,
        },
      });

      throw error;
    }
  }

  async createProductCheckoutPro(dto: {
    produtoId: string;
    userId: string;
    userEmail: string;
  }) {
    const produto = await this.produtosRepository.findOne({
      where: { id: dto.produtoId },
    });

    if (!produto) {
      throw new BadRequestException('Produto nao encontrado');
    }

    if (!produto.ativo) {
      throw new BadRequestException('Produto inativo');
    }

    const accessToken = this.getMercadoPagoAccessToken();
    const unitPrice = Number(produto.preco);

    if (Number.isNaN(unitPrice) || unitPrice <= 0) {
      throw new InternalServerErrorException(
        'Valor do produto invalido para checkout',
      );
    }

    let pagamento = await this.pagamentosRepository.save(
      this.pagamentosRepository.create({
        assinatura_id: null,
        usuario_id: dto.userId,
        plano_id: null,
        gateway: 'MERCADO_PAGO',
        gateway_pagamento_id: null,
        gateway_preferencia_id: null,
        gateway_checkout_id: null,
        status: 'PENDING',
        valor:
          typeof produto.preco === 'string'
            ? produto.preco
            : String(produto.preco),
        moeda: (produto.moeda || 'BRL').toUpperCase(),
        forma_pagamento: null,
        parcelas: null,
        descricao: `Produto ${produto.nome}`,
        motivo_recusa: null,
        detalhes_gateway: {
          etapa: 'product_preference_requested',
          produtoId: produto.id,
        },
        data_pagamento: null,
        data_vencimento: null,
      }),
    );

    const externalReference = this.buildProductExternalReference({
      pagamentoId: pagamento.id,
      userId: dto.userId,
      produtoId: produto.id,
    });

    try {
      const frontendUrl = this.getFrontendUrl();
      const webhookUrl = this.getWebhookUrl();

      const payload = {
        items: [
          {
            id: produto.id,
            title: produto.nome,
            description: produto.descricao ?? undefined,
            quantity: 1,
            unit_price: unitPrice,
            currency_id: this.normalizeCurrencyForMercadoPago(produto.moeda),
          },
        ],
        payer: {
          email: dto.userEmail,
        },
        external_reference: externalReference,
        metadata: {
          userId: dto.userId,
          pagamentoId: pagamento.id,
          produtoId: produto.id,
        },
        back_urls: {
          success: `${frontendUrl}/produtos/checkout/resultado?status=success`,
          failure: `${frontendUrl}/produtos/checkout/resultado?status=failure`,
          pending: `${frontendUrl}/produtos/checkout/resultado?status=pending`,
        },
        auto_return: 'approved',
        notification_url: webhookUrl,
      };

      const response = await fetch(
        'https://api.mercadopago.com/checkout/preferences',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify(payload),
        },
      );

      const responsePayload = (await response
        .json()
        .catch(() => null)) as MercadoPagoPreferenceResponse | null;

      if (!response.ok) {
        throw new BadGatewayException(
          this.resolveMercadoPagoError(
            responsePayload,
            'Nao foi possivel criar o checkout do produto no Mercado Pago',
          ),
        );
      }

      const checkoutUrl =
        (typeof responsePayload?.init_point === 'string' &&
          responsePayload.init_point) ||
        (typeof responsePayload?.sandbox_init_point === 'string' &&
          responsePayload.sandbox_init_point) ||
        '';

      if (!checkoutUrl) {
        throw new BadGatewayException(
          'Mercado Pago nao retornou URL de checkout',
        );
      }

      pagamento.gateway_preferencia_id = responsePayload?.id ?? null;
      pagamento.gateway_checkout_id = responsePayload?.id ?? null;
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa: 'product_preference_created',
        preference_id: responsePayload?.id ?? null,
        produtoId: produto.id,
      };
      pagamento = await this.pagamentosRepository.save(pagamento);

      await this.createLog({
        nivel: 'INFO',
        evento: 'CHECKOUT_PRODUTO_CRIADO',
        descricao: `Checkout de produto criado para pagamento ${pagamento.id}`,
        usuarioId: dto.userId,
        pagamentoId: pagamento.id,
        detalhes: {
          produtoId: produto.id,
          preferenceId: responsePayload?.id ?? null,
        },
      });

      return {
        preference_id: responsePayload?.id ?? null,
        checkout_url: checkoutUrl,
        pagamento_id: pagamento.id,
        produto_id: produto.id,
      };
    } catch (error) {
      pagamento.status = 'FAILED';
      pagamento.motivo_recusa = this.normalizeErrorMessage(
        error,
        'Falha ao criar checkout de produto no Mercado Pago',
      );
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa: 'product_preference_error',
        erro: pagamento.motivo_recusa,
        produtoId: produto.id,
      };
      await this.pagamentosRepository.save(pagamento);

      await this.createLog({
        nivel: 'ERROR',
        evento: 'CHECKOUT_PRODUTO_ERRO',
        descricao: `Falha ao criar checkout de produto para pagamento ${pagamento.id}`,
        usuarioId: dto.userId,
        pagamentoId: pagamento.id,
        detalhes: {
          produtoId: produto.id,
          erro: pagamento.motivo_recusa,
        },
      });

      throw error;
    }
  }

  async createAssociatedPlanSubscription(dto: {
    planoId: string;
    userId: string;
    userEmail: string;
  }) {
    const plano = await this.planosService.findOne(dto.planoId);

    if (!plano.ativo) {
      throw new BadRequestException('Plano inativo');
    }

    const accessToken = this.getMercadoPagoAccessToken();
    const frontendUrl = this.getFrontendUrl();

    let assinatura = await this.assinaturasRepository.save(
      this.assinaturasRepository.create({
        usuario_id: dto.userId,
        plano_id: plano.id,
        status: 'PENDING_PAYMENT',
        gateway: 'MERCADO_PAGO',
        gateway_cliente_id: null,
        gateway_assinatura_id: null,
        renovacao_automatica: true,
        data_inicio: null,
        data_fim: null,
        proxima_cobranca_em: null,
        cancelado_em: null,
        observacoes: 'Assinatura recorrente iniciada',
      }),
    );

    let pagamento = await this.pagamentosRepository.save(
      this.pagamentosRepository.create({
        assinatura_id: assinatura.id,
        usuario_id: dto.userId,
        plano_id: plano.id,
        gateway: 'MERCADO_PAGO_SUBSCRIPTION',
        gateway_pagamento_id: null,
        gateway_preferencia_id: null,
        gateway_checkout_id: null,
        status: 'PENDING',
        valor:
          typeof plano.valor === 'string' ? plano.valor : String(plano.valor),
        moeda: this.normalizeCurrencyForMercadoPago(plano.moeda),
        forma_pagamento: null,
        parcelas: null,
        descricao: `Assinatura recorrente ${plano.nome}`,
        motivo_recusa: null,
        detalhes_gateway: {
          etapa: 'preapproval_plan_requested',
          planoId: plano.id,
        },
        data_pagamento: null,
        data_vencimento: null,
      }),
    );

    const externalReference = this.buildExternalReference({
      assinaturaId: assinatura.id,
      pagamentoId: pagamento.id,
      userId: dto.userId,
      planoId: plano.id,
    });

    try {
      const checkoutResultUrl = `${frontendUrl}/assinatura/checkout/resultado?status=pending&flow=subscription`;
      const autoRecurring = this.buildAutoRecurringFromPlano(plano);

      const preapprovalPlanPayload = {
        reason: `Plano ${plano.nome}`,
        external_reference: `pln:${plano.id}`,
        auto_recurring: autoRecurring,
        back_url: checkoutResultUrl,
      };

      const preapprovalPlanResponse = await fetch(
        'https://api.mercadopago.com/preapproval_plan',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': randomUUID(),
          },
          body: JSON.stringify(preapprovalPlanPayload),
        },
      );

      const preapprovalPlanData = (await preapprovalPlanResponse
        .json()
        .catch(() => null)) as MercadoPagoPreapprovalPlanResponse | null;

      if (!preapprovalPlanResponse.ok) {
        throw new BadGatewayException(
          this.resolveMercadoPagoError(
            preapprovalPlanData,
            'Nao foi possivel criar o plano de assinatura no Mercado Pago',
          ),
        );
      }

      const preapprovalPlanId =
        typeof preapprovalPlanData?.id === 'string'
          ? preapprovalPlanData.id.trim()
          : '';

      if (!preapprovalPlanId) {
        throw new BadGatewayException(
          'Mercado Pago nao retornou id do plano de assinatura',
        );
      }

      pagamento.gateway_preferencia_id = preapprovalPlanId;
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa: 'preapproval_plan_created',
        mp_preapproval_plan_id: preapprovalPlanId,
      };
      pagamento = await this.pagamentosRepository.save(pagamento);

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': randomUUID(),
      };

      let preapprovalData: MercadoPagoPreapprovalResponse | null = null;
      let flowMode: 'ASSOCIATED_PLAN' | 'DIRECT_PENDING' = 'ASSOCIATED_PLAN';

      const associatedPlanPayload = {
        preapproval_plan_id: preapprovalPlanId,
        reason: `Assinatura ${plano.nome}`,
        external_reference: externalReference,
        payer_email: dto.userEmail,
        back_url: checkoutResultUrl,
      };

      const preapprovalResponse = await fetch(
        'https://api.mercadopago.com/preapproval',
        {
          method: 'POST',
          headers,
          body: JSON.stringify(associatedPlanPayload),
        },
      );

      preapprovalData = (await preapprovalResponse
        .json()
        .catch(() => null)) as MercadoPagoPreapprovalResponse | null;

      if (!preapprovalResponse.ok) {
        const associatedPlanError = this.resolveMercadoPagoError(
          preapprovalData,
          'Nao foi possivel criar a assinatura recorrente no Mercado Pago',
        );

        const shouldFallbackToDirectPending =
          associatedPlanError.toLowerCase().includes('card_token_id') &&
          associatedPlanError.toLowerCase().includes('required');

        if (!shouldFallbackToDirectPending) {
          throw new BadGatewayException(associatedPlanError);
        }

        const directPendingPayload = {
          reason: `Assinatura ${plano.nome}`,
          external_reference: externalReference,
          payer_email: dto.userEmail,
          auto_recurring: autoRecurring,
          back_url: checkoutResultUrl,
          status: 'pending',
        };

        const directPendingResponse = await fetch(
          'https://api.mercadopago.com/preapproval',
          {
            method: 'POST',
            headers: {
              ...headers,
              'X-Idempotency-Key': randomUUID(),
            },
            body: JSON.stringify(directPendingPayload),
          },
        );

        preapprovalData = (await directPendingResponse
          .json()
          .catch(() => null)) as MercadoPagoPreapprovalResponse | null;

        if (!directPendingResponse.ok) {
          throw new BadGatewayException(
            this.resolveMercadoPagoError(
              preapprovalData,
              'Nao foi possivel criar a assinatura recorrente no Mercado Pago',
            ),
          );
        }

        flowMode = 'DIRECT_PENDING';
      }

      const preapprovalId =
        typeof preapprovalData?.id === 'string'
          ? preapprovalData.id.trim()
          : '';
      const checkoutUrl =
        typeof preapprovalData?.init_point === 'string'
          ? preapprovalData.init_point.trim()
          : '';

      if (!preapprovalId) {
        throw new BadGatewayException(
          'Mercado Pago nao retornou id da assinatura recorrente',
        );
      }

      if (!checkoutUrl) {
        throw new BadGatewayException(
          'Mercado Pago nao retornou URL de autorizacao da assinatura',
        );
      }

      const subscriptionStatus = this.mapMercadoPagoSubscriptionStatus(
        preapprovalData?.status,
      );
      const payerId = this.normalizeAnyToString(preapprovalData?.payer_id);

      assinatura.gateway_assinatura_id = preapprovalId;
      assinatura.gateway_cliente_id = payerId ?? assinatura.gateway_cliente_id;
      assinatura.status = subscriptionStatus.assinaturaStatus;
      assinatura.observacoes = `Assinatura criada no Mercado Pago: ${subscriptionStatus.originalStatus}`;
      if (subscriptionStatus.isActive) {
        assinatura.data_inicio = assinatura.data_inicio ?? new Date();
        assinatura.cancelado_em = null;
        assinatura.proxima_cobranca_em = await this.calculateNextChargeDate(
          assinatura.plano_id,
          assinatura.data_inicio,
        );
      }
      assinatura = await this.assinaturasRepository.save(assinatura);

      pagamento.gateway_checkout_id = preapprovalId;
      pagamento.status = subscriptionStatus.pagamentoStatus;
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa:
          flowMode === 'DIRECT_PENDING'
            ? 'preapproval_created_direct_pending'
            : 'preapproval_created',
        mp_preapproval_id: preapprovalId,
        mp_preapproval_status: preapprovalData?.status ?? null,
        mp_subscription_flow: flowMode,
      };
      pagamento = await this.pagamentosRepository.save(pagamento);

      await this.createLog({
        nivel: 'INFO',
        evento: 'ASSINATURA_MP_CRIADA',
        descricao: `Assinatura recorrente criada para pagamento ${pagamento.id}`,
        usuarioId: dto.userId,
        assinaturaId: assinatura.id,
        pagamentoId: pagamento.id,
        detalhes: {
          planoId: plano.id,
          preapprovalPlanId,
          preapprovalId,
          flowMode,
        },
      });

      return {
        preapproval_plan_id: preapprovalPlanId,
        preapproval_id: preapprovalId,
        checkout_url: checkoutUrl,
        assinatura_id: assinatura.id,
        pagamento_id: pagamento.id,
        flow_mode: flowMode,
      };
    } catch (error) {
      pagamento.status = 'FAILED';
      pagamento.motivo_recusa = this.normalizeErrorMessage(
        error,
        'Falha ao criar assinatura recorrente no Mercado Pago',
      );
      pagamento.detalhes_gateway = {
        ...(pagamento.detalhes_gateway ?? {}),
        etapa: 'preapproval_error',
        erro: pagamento.motivo_recusa,
      };
      await this.pagamentosRepository.save(pagamento);

      assinatura.status = 'CANCELLED';
      assinatura.cancelado_em = new Date();
      assinatura.observacoes = `Assinatura cancelada por erro: ${pagamento.motivo_recusa}`;
      await this.assinaturasRepository.save(assinatura);

      await this.createLog({
        nivel: 'ERROR',
        evento: 'ASSINATURA_MP_ERRO',
        descricao: `Falha ao criar assinatura recorrente para pagamento ${pagamento.id}`,
        usuarioId: dto.userId,
        assinaturaId: assinatura.id,
        pagamentoId: pagamento.id,
        detalhes: {
          erro: pagamento.motivo_recusa,
        },
      });

      throw error;
    }
  }

  async confirmMercadoPagoPayment(paymentId: string, userId: string) {
    const gatewayPaymentId = paymentId.trim();

    if (!gatewayPaymentId) {
      throw new BadRequestException('paymentId e obrigatorio');
    }

    const sync = await this.syncPaymentByGatewayPaymentId(gatewayPaymentId, {
      trigger: 'manual',
    });

    if (sync.usuarioId !== userId) {
      throw new BadRequestException(
        'Pagamento nao pertence ao usuario autenticado',
      );
    }

    return {
      status: 'SYNCED',
      pagamento_id: sync.pagamentoId,
      assinatura_id: sync.assinaturaId,
      payment_status: sync.paymentStatus,
    };
  }

  async confirmMercadoPagoSubscription(preapprovalId: string, userId: string) {
    const gatewaySubscriptionId = preapprovalId.trim();

    if (!gatewaySubscriptionId) {
      throw new BadRequestException('preapprovalId e obrigatorio');
    }

    const sync = await this.syncSubscriptionByGatewaySubscriptionId(
      gatewaySubscriptionId,
      {
        trigger: 'manual',
      },
    );

    if (sync.usuarioId !== userId) {
      throw new BadRequestException(
        'Assinatura nao pertence ao usuario autenticado',
      );
    }

    return {
      status: 'SYNCED',
      pagamento_id: sync.pagamentoId,
      assinatura_id: sync.assinaturaId,
      subscription_status: sync.paymentStatus,
    };
  }

  async handleMercadoPagoWebhook(input: WebhookInput) {
    const eventType = this.extractEventType(input.query, input.body);
    const action = this.extractAction(input.body, input.query);
    const webhookExternalId = this.extractWebhookExternalId(
      input.body,
      input.query,
    );
    const paymentId = this.extractPaymentId(eventType, input.query, input.body);
    const preapprovalId = this.extractPreapprovalId(
      eventType,
      input.query,
      input.body,
    );
    const signatureValidation = this.validateMercadoPagoWebhookSignature({
      headers: input.headers,
      query: input.query,
      paymentId,
      preapprovalId,
    });

    const webhook = await this.webhooksRepository.save(
      this.webhooksRepository.create({
        gateway: 'MERCADO_PAGO',
        tipo_evento: eventType,
        acao: action,
        webhook_id_externo: webhookExternalId,
        assinatura_id: null,
        pagamento_id: null,
        payload: {
          query: input.query,
          body: input.body,
        },
        headers: input.headers,
        assinatura_valida: signatureValidation.isValid,
        processado: false,
        data_processamento: null,
        erro_processamento: null,
      }),
    );

    if (signatureValidation.enforced && signatureValidation.isValid === false) {
      webhook.processado = true;
      webhook.data_processamento = new Date();
      webhook.erro_processamento =
        signatureValidation.reason ?? 'Assinatura do webhook invalida';
      await this.webhooksRepository.save(webhook);

      await this.createLog({
        nivel: 'WARN',
        evento: 'WEBHOOK_ASSINATURA_INVALIDA',
        descricao: `Webhook ${webhook.id} rejeitado por assinatura invalida`,
        webhookId: webhook.id,
        detalhes: {
          eventType,
          action,
          paymentId,
          preapprovalId,
          motivo: webhook.erro_processamento,
        },
      });

      return {
        received: true,
        processed: false,
        webhook_id: webhook.id,
      };
    }

    if (!paymentId && !preapprovalId) {
      webhook.processado = true;
      webhook.data_processamento = new Date();
      webhook.erro_processamento =
        'payment id ou preapproval id nao informado no webhook';
      await this.webhooksRepository.save(webhook);

      await this.createLog({
        nivel: 'WARN',
        evento: 'WEBHOOK_IGNORADO',
        descricao: `Webhook ${webhook.id} ignorado por ausencia de identificador`,
        webhookId: webhook.id,
        detalhes: {
          eventType,
          action,
          webhookExternalId,
        },
      });

      return {
        received: true,
        processed: false,
        webhook_id: webhook.id,
      };
    }

    try {
      const sync = paymentId
        ? await this.syncPaymentByGatewayPaymentId(paymentId, {
            trigger: 'webhook',
            webhookId: webhook.id,
          })
        : await this.syncSubscriptionByGatewaySubscriptionId(preapprovalId!, {
            trigger: 'webhook',
            webhookId: webhook.id,
          });

      webhook.processado = true;
      webhook.data_processamento = new Date();
      webhook.erro_processamento = null;
      webhook.pagamento_id = sync.pagamentoId;
      webhook.assinatura_id = sync.assinaturaId;
      await this.webhooksRepository.save(webhook);

      await this.createLog({
        nivel: 'INFO',
        evento: 'WEBHOOK_PROCESSADO',
        descricao: `Webhook ${webhook.id} processado com sucesso`,
        webhookId: webhook.id,
        usuarioId: sync.usuarioId,
        assinaturaId: sync.assinaturaId,
        pagamentoId: sync.pagamentoId,
        detalhes: {
          eventType,
          action,
          paymentId,
          preapprovalId,
          paymentStatus: sync.paymentStatus,
        },
      });

      return {
        received: true,
        processed: true,
        webhook_id: webhook.id,
        pagamento_id: sync.pagamentoId,
        assinatura_id: sync.assinaturaId,
      };
    } catch (error) {
      webhook.data_processamento = new Date();
      webhook.erro_processamento = this.normalizeErrorMessage(
        error,
        'Erro ao processar webhook',
      );
      webhook.processado = false;
      await this.webhooksRepository.save(webhook);

      await this.createLog({
        nivel: 'ERROR',
        evento: 'WEBHOOK_ERRO',
        descricao: `Erro ao processar webhook ${webhook.id}`,
        webhookId: webhook.id,
        detalhes: {
          paymentId,
          preapprovalId,
          erro: webhook.erro_processamento,
        },
      });

      throw error;
    }
  }

  private async syncPaymentByGatewayPaymentId(
    gatewayPaymentId: string,
    context: { trigger: 'webhook' | 'manual'; webhookId?: string },
  ): Promise<SyncResult> {
    const mpPayment = await this.fetchMercadoPagoPayment(gatewayPaymentId);
    const parsedReference = this.parseExternalReference(
      mpPayment.external_reference,
    );
    const parsedMetadata = this.parseMetadata(mpPayment.metadata);

    const resolved = {
      assinaturaId: parsedReference.assinaturaId ?? parsedMetadata.assinaturaId,
      pagamentoId: parsedReference.pagamentoId ?? parsedMetadata.pagamentoId,
      userId: parsedReference.userId ?? parsedMetadata.userId,
      planoId: parsedReference.planoId ?? parsedMetadata.planoId,
      produtoId: parsedReference.produtoId ?? parsedMetadata.produtoId,
      preferenceId: parsedReference.preferenceId ?? parsedMetadata.preferenceId,
    };

    let pagamento = await this.pagamentosRepository.findOne({
      where: { gateway_pagamento_id: String(mpPayment.id ?? gatewayPaymentId) },
    });

    if (!pagamento && resolved.pagamentoId) {
      pagamento = await this.pagamentosRepository.findOne({
        where: { id: resolved.pagamentoId },
      });
    }

    let assinatura: Assinatura | null = null;

    if (pagamento?.assinatura_id) {
      assinatura = await this.assinaturasRepository.findOne({
        where: { id: pagamento.assinatura_id },
      });
    }

    if (!assinatura && resolved.assinaturaId) {
      assinatura = await this.assinaturasRepository.findOne({
        where: { id: resolved.assinaturaId },
      });
    }

    if (!pagamento) {
      if (!resolved.userId) {
        throw new BadRequestException(
          'Webhook sem userId para criar registro de pagamento',
        );
      }

      if (!resolved.planoId && !resolved.produtoId) {
        throw new BadRequestException(
          'Webhook sem planoId/produtoId para criar registro de pagamento',
        );
      }

      if (!assinatura && resolved.planoId) {
        assinatura = await this.assinaturasRepository.save(
          this.assinaturasRepository.create({
            usuario_id: resolved.userId,
            plano_id: resolved.planoId,
            status: 'PENDING_PAYMENT',
            gateway: 'MERCADO_PAGO',
            gateway_cliente_id: null,
            gateway_assinatura_id: null,
            renovacao_automatica: true,
            data_inicio: null,
            data_fim: null,
            proxima_cobranca_em: null,
            cancelado_em: null,
            observacoes: 'Criada por sincronizacao de webhook',
          }),
        );
      }

      pagamento = await this.pagamentosRepository.save(
        this.pagamentosRepository.create({
          assinatura_id: assinatura?.id ?? null,
          usuario_id: resolved.userId,
          plano_id: resolved.planoId ?? null,
          gateway: 'MERCADO_PAGO',
          gateway_pagamento_id: null,
          gateway_preferencia_id: resolved.preferenceId ?? null,
          gateway_checkout_id: null,
          status: 'PENDING',
          valor: this.normalizeAmount(mpPayment.transaction_amount),
          moeda: this.normalizeDbCurrency(mpPayment.currency_id),
          forma_pagamento: null,
          parcelas: null,
          descricao: mpPayment.description ?? 'Pagamento Mercado Pago',
          motivo_recusa: null,
          detalhes_gateway: resolved.produtoId
            ? {
                produtoId: resolved.produtoId,
              }
            : null,
          data_pagamento: null,
          data_vencimento: null,
        }),
      );
    }

    const statusMap = this.mapMercadoPagoStatus(mpPayment.status);

    pagamento.gateway = 'MERCADO_PAGO';
    pagamento.gateway_pagamento_id = String(mpPayment.id ?? gatewayPaymentId);
    pagamento.gateway_preferencia_id =
      resolved.preferenceId ?? pagamento.gateway_preferencia_id;
    pagamento.status = statusMap.pagamentoStatus;
    pagamento.valor = this.normalizeAmount(
      mpPayment.transaction_amount,
      pagamento.valor,
    );
    pagamento.moeda = this.normalizeDbCurrency(
      mpPayment.currency_id,
      pagamento.moeda,
    );
    pagamento.forma_pagamento =
      typeof mpPayment.payment_method_id === 'string' &&
      mpPayment.payment_method_id.trim().length > 0
        ? mpPayment.payment_method_id
        : pagamento.forma_pagamento;
    pagamento.parcelas =
      typeof mpPayment.installments === 'number' &&
      Number.isFinite(mpPayment.installments)
        ? mpPayment.installments
        : pagamento.parcelas;
    pagamento.descricao = mpPayment.description ?? pagamento.descricao;
    pagamento.motivo_recusa = statusMap.isFailure
      ? (mpPayment.status_detail ?? pagamento.motivo_recusa)
      : null;
    pagamento.data_pagamento =
      this.parseDate(mpPayment.date_approved) ?? pagamento.data_pagamento;
    pagamento.data_vencimento =
      this.parseDate(mpPayment.date_of_expiration) ?? pagamento.data_vencimento;
    const produtoIdAnterior =
      this.normalizeAnyToString(pagamento.detalhes_gateway?.produtoId) ?? null;

    pagamento.detalhes_gateway = {
      ...(pagamento.detalhes_gateway ?? {}),
      sync_trigger: context.trigger,
      synced_at: new Date().toISOString(),
      mp_payment_id: String(mpPayment.id ?? gatewayPaymentId),
      mp_status: mpPayment.status ?? null,
      mp_status_detail: mpPayment.status_detail ?? null,
      webhook_id: context.webhookId ?? null,
      produtoId: resolved.produtoId ?? produtoIdAnterior,
    };

    if (!pagamento.usuario_id && resolved.userId) {
      pagamento.usuario_id = resolved.userId;
    }

    if (!pagamento.plano_id && resolved.planoId) {
      pagamento.plano_id = resolved.planoId;
    }

    if (!assinatura && pagamento.assinatura_id) {
      assinatura = await this.assinaturasRepository.findOne({
        where: { id: pagamento.assinatura_id },
      });
    }

    if (!assinatura && pagamento.usuario_id && pagamento.plano_id) {
      assinatura = await this.assinaturasRepository.save(
        this.assinaturasRepository.create({
          usuario_id: pagamento.usuario_id,
          plano_id: pagamento.plano_id,
          status: 'PENDING_PAYMENT',
          gateway: 'MERCADO_PAGO',
          gateway_cliente_id: null,
          gateway_assinatura_id: null,
          renovacao_automatica: true,
          data_inicio: null,
          data_fim: null,
          proxima_cobranca_em: null,
          cancelado_em: null,
          observacoes: 'Criada durante sincronizacao de pagamento',
        }),
      );
    }

    if (assinatura && pagamento.assinatura_id !== assinatura.id) {
      pagamento.assinatura_id = assinatura.id;
    }

    pagamento = await this.pagamentosRepository.save(pagamento);

    if (assinatura) {
      if (statusMap.isApproved) {
        assinatura.status = 'ACTIVE';
        assinatura.data_inicio =
          assinatura.data_inicio ?? pagamento.data_pagamento ?? new Date();
        assinatura.cancelado_em = null;
        assinatura.proxima_cobranca_em = await this.calculateNextChargeDate(
          assinatura.plano_id,
          assinatura.data_inicio,
        );
      } else if (statusMap.isFailure) {
        if (assinatura.status !== 'ACTIVE') {
          assinatura.status = 'CANCELLED';
          assinatura.cancelado_em = new Date();
        }
      } else if (assinatura.status !== 'ACTIVE') {
        assinatura.status = 'PENDING_PAYMENT';
      }

      assinatura.observacoes = `Atualizado via Mercado Pago: ${statusMap.originalStatus}`;
      assinatura = await this.assinaturasRepository.save(assinatura);
    }

    await this.createLog({
      nivel: 'INFO',
      evento: 'PAGAMENTO_SINCRONIZADO',
      descricao: `Pagamento ${pagamento.id} sincronizado (${pagamento.status})`,
      usuarioId: pagamento.usuario_id,
      assinaturaId: assinatura?.id ?? null,
      pagamentoId: pagamento.id,
      webhookId: context.webhookId ?? null,
      detalhes: {
        mpPaymentId: pagamento.gateway_pagamento_id,
        mpStatus: mpPayment.status ?? null,
        trigger: context.trigger,
      },
    });

    return {
      pagamentoId: pagamento.id,
      assinaturaId: assinatura?.id ?? null,
      usuarioId: pagamento.usuario_id,
      paymentStatus: pagamento.status,
    };
  }

  private async syncSubscriptionByGatewaySubscriptionId(
    gatewaySubscriptionId: string,
    context: { trigger: 'webhook' | 'manual'; webhookId?: string },
  ): Promise<SyncResult> {
    const mpSubscription = await this.fetchMercadoPagoSubscription(
      gatewaySubscriptionId,
    );
    const parsedReference = this.parseExternalReference(
      mpSubscription.external_reference,
    );
    const parsedMetadata: ParsedReference = {};

    const resolved = {
      assinaturaId: parsedReference.assinaturaId ?? parsedMetadata.assinaturaId,
      pagamentoId: parsedReference.pagamentoId ?? parsedMetadata.pagamentoId,
      userId: parsedReference.userId ?? parsedMetadata.userId,
      planoId: parsedReference.planoId ?? parsedMetadata.planoId,
      preferenceId:
        this.normalizeAnyToString(mpSubscription.preapproval_plan_id) ??
        parsedReference.preferenceId ??
        parsedMetadata.preferenceId,
    };

    let assinatura = await this.assinaturasRepository.findOne({
      where: { gateway_assinatura_id: gatewaySubscriptionId },
    });

    if (!assinatura && resolved.assinaturaId) {
      assinatura = await this.assinaturasRepository.findOne({
        where: { id: resolved.assinaturaId },
      });
    }

    let pagamento: Pagamento | null = null;

    if (assinatura?.id) {
      pagamento = await this.pagamentosRepository.findOne({
        where: {
          assinatura_id: assinatura.id,
          gateway: 'MERCADO_PAGO_SUBSCRIPTION',
        },
        order: { id: 'DESC' },
      });
    }

    if (!pagamento && resolved.pagamentoId) {
      pagamento = await this.pagamentosRepository.findOne({
        where: { id: resolved.pagamentoId },
      });
    }

    if (!assinatura) {
      if (!resolved.userId || !resolved.planoId) {
        throw new BadRequestException(
          'Webhook sem userId/planoId para sincronizar assinatura',
        );
      }

      assinatura = await this.assinaturasRepository.save(
        this.assinaturasRepository.create({
          usuario_id: resolved.userId,
          plano_id: resolved.planoId,
          status: 'PENDING_PAYMENT',
          gateway: 'MERCADO_PAGO',
          gateway_cliente_id: null,
          gateway_assinatura_id: gatewaySubscriptionId,
          renovacao_automatica: true,
          data_inicio: null,
          data_fim: null,
          proxima_cobranca_em: null,
          cancelado_em: null,
          observacoes: 'Criada por sincronizacao de assinatura',
        }),
      );
    }

    if (!pagamento) {
      const valor = this.normalizeAmount(
        mpSubscription.auto_recurring?.transaction_amount,
      );
      pagamento = await this.pagamentosRepository.save(
        this.pagamentosRepository.create({
          assinatura_id: assinatura.id,
          usuario_id: resolved.userId ?? assinatura.usuario_id,
          plano_id: resolved.planoId ?? assinatura.plano_id,
          gateway: 'MERCADO_PAGO_SUBSCRIPTION',
          gateway_pagamento_id: null,
          gateway_preferencia_id: resolved.preferenceId ?? null,
          gateway_checkout_id: gatewaySubscriptionId,
          status: 'PENDING',
          valor,
          moeda: this.normalizeDbCurrency(
            mpSubscription.auto_recurring?.currency_id,
          ),
          forma_pagamento: 'subscription',
          parcelas: null,
          descricao: mpSubscription.reason ?? 'Assinatura Mercado Pago',
          motivo_recusa: null,
          detalhes_gateway: null,
          data_pagamento: null,
          data_vencimento: null,
        }),
      );
    }

    const statusMap = this.mapMercadoPagoSubscriptionStatus(
      mpSubscription.status,
    );
    const payerId = this.normalizeAnyToString(mpSubscription.payer_id);
    const nextPaymentDate =
      this.parseDate(mpSubscription.next_payment_date) ??
      this.parseDate(mpSubscription.auto_recurring?.next_payment_date);

    assinatura.gateway_assinatura_id = gatewaySubscriptionId;
    assinatura.gateway_cliente_id = payerId ?? assinatura.gateway_cliente_id;
    assinatura.status = statusMap.assinaturaStatus;
    assinatura.observacoes = `Atualizado via assinatura Mercado Pago: ${statusMap.originalStatus}`;

    if (statusMap.isActive) {
      assinatura.data_inicio =
        assinatura.data_inicio ??
        this.parseDate(mpSubscription.date_created) ??
        new Date();
      assinatura.cancelado_em = null;
      assinatura.proxima_cobranca_em =
        nextPaymentDate ??
        (await this.calculateNextChargeDate(
          assinatura.plano_id,
          assinatura.data_inicio,
        ));
    } else if (statusMap.isCancelled) {
      assinatura.cancelado_em = assinatura.cancelado_em ?? new Date();
      assinatura.data_fim = assinatura.data_fim ?? assinatura.cancelado_em;
    }

    assinatura = await this.assinaturasRepository.save(assinatura);

    pagamento.assinatura_id = assinatura.id;
    pagamento.usuario_id = pagamento.usuario_id || assinatura.usuario_id;
    pagamento.plano_id = pagamento.plano_id || assinatura.plano_id;
    pagamento.gateway = 'MERCADO_PAGO_SUBSCRIPTION';
    pagamento.gateway_checkout_id = gatewaySubscriptionId;
    pagamento.gateway_preferencia_id =
      resolved.preferenceId ?? pagamento.gateway_preferencia_id;
    pagamento.status = statusMap.pagamentoStatus;
    pagamento.valor = this.normalizeAmount(
      mpSubscription.auto_recurring?.transaction_amount,
      pagamento.valor,
    );
    pagamento.moeda = this.normalizeDbCurrency(
      mpSubscription.auto_recurring?.currency_id,
      pagamento.moeda,
    );
    pagamento.descricao = mpSubscription.reason ?? pagamento.descricao;
    pagamento.forma_pagamento = 'subscription';
    pagamento.motivo_recusa = statusMap.isCancelled
      ? (mpSubscription.status ?? pagamento.motivo_recusa)
      : null;
    pagamento.data_pagamento = statusMap.isActive
      ? (pagamento.data_pagamento ?? assinatura.data_inicio ?? new Date())
      : pagamento.data_pagamento;
    pagamento.data_vencimento = nextPaymentDate ?? pagamento.data_vencimento;
    pagamento.detalhes_gateway = {
      ...(pagamento.detalhes_gateway ?? {}),
      sync_trigger: context.trigger,
      synced_at: new Date().toISOString(),
      mp_preapproval_id: gatewaySubscriptionId,
      mp_preapproval_plan_id: resolved.preferenceId ?? null,
      mp_status: mpSubscription.status ?? null,
      webhook_id: context.webhookId ?? null,
    };

    pagamento = await this.pagamentosRepository.save(pagamento);

    await this.createLog({
      nivel: 'INFO',
      evento: 'ASSINATURA_MP_SINCRONIZADA',
      descricao: `Assinatura ${assinatura.id} sincronizada (${assinatura.status})`,
      usuarioId: assinatura.usuario_id,
      assinaturaId: assinatura.id,
      pagamentoId: pagamento.id,
      webhookId: context.webhookId ?? null,
      detalhes: {
        mpPreapprovalId: gatewaySubscriptionId,
        mpStatus: mpSubscription.status ?? null,
        trigger: context.trigger,
      },
    });

    return {
      pagamentoId: pagamento.id,
      assinaturaId: assinatura.id,
      usuarioId: assinatura.usuario_id,
      paymentStatus: assinatura.status,
    };
  }

  private async fetchMercadoPagoPayment(
    paymentId: string,
  ): Promise<MercadoPagoPaymentResponse> {
    const accessToken = this.getMercadoPagoAccessToken();

    const response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const payload = (await response
      .json()
      .catch(() => null)) as MercadoPagoPaymentResponse | null;

    if (!response.ok) {
      throw new BadGatewayException(
        this.resolveMercadoPagoError(
          payload as MercadoPagoPreferenceResponse | null,
          'Falha ao consultar pagamento no Mercado Pago',
        ),
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayException(
        'Resposta invalida do Mercado Pago ao consultar pagamento',
      );
    }

    return payload;
  }

  private async fetchMercadoPagoSubscription(
    preapprovalId: string,
  ): Promise<MercadoPagoPreapprovalResponse> {
    const accessToken = this.getMercadoPagoAccessToken();

    const response = await fetch(
      `https://api.mercadopago.com/preapproval/${encodeURIComponent(preapprovalId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const payload = (await response
      .json()
      .catch(() => null)) as MercadoPagoPreapprovalResponse | null;

    if (!response.ok) {
      throw new BadGatewayException(
        this.resolveMercadoPagoError(
          payload,
          'Falha ao consultar assinatura no Mercado Pago',
        ),
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new BadGatewayException(
        'Resposta invalida do Mercado Pago ao consultar assinatura',
      );
    }

    return payload;
  }

  private mapMercadoPagoStatus(status: string | undefined): {
    pagamentoStatus: string;
    isApproved: boolean;
    isFailure: boolean;
    originalStatus: string;
  } {
    const normalized = (status || 'unknown').toLowerCase();

    if (normalized === 'approved') {
      return {
        pagamentoStatus: 'APPROVED',
        isApproved: true,
        isFailure: false,
        originalStatus: normalized,
      };
    }

    if (
      normalized === 'rejected' ||
      normalized === 'cancelled' ||
      normalized === 'refunded' ||
      normalized === 'charged_back'
    ) {
      return {
        pagamentoStatus: 'REJECTED',
        isApproved: false,
        isFailure: true,
        originalStatus: normalized,
      };
    }

    if (
      normalized === 'pending' ||
      normalized === 'in_process' ||
      normalized === 'authorized'
    ) {
      return {
        pagamentoStatus: 'PENDING',
        isApproved: false,
        isFailure: false,
        originalStatus: normalized,
      };
    }

    return {
      pagamentoStatus: 'PENDING',
      isApproved: false,
      isFailure: false,
      originalStatus: normalized,
    };
  }

  private mapMercadoPagoSubscriptionStatus(status: string | undefined): {
    pagamentoStatus: string;
    assinaturaStatus: string;
    isActive: boolean;
    isCancelled: boolean;
    originalStatus: string;
  } {
    const normalized = (status || 'unknown').toLowerCase();

    if (normalized === 'authorized') {
      return {
        pagamentoStatus: 'APPROVED',
        assinaturaStatus: 'ACTIVE',
        isActive: true,
        isCancelled: false,
        originalStatus: normalized,
      };
    }

    if (normalized === 'paused') {
      return {
        pagamentoStatus: 'PENDING',
        assinaturaStatus: 'PAUSED',
        isActive: false,
        isCancelled: false,
        originalStatus: normalized,
      };
    }

    if (
      normalized === 'cancelled' ||
      normalized === 'finished' ||
      normalized === 'expired'
    ) {
      return {
        pagamentoStatus: 'REJECTED',
        assinaturaStatus: 'CANCELLED',
        isActive: false,
        isCancelled: true,
        originalStatus: normalized,
      };
    }

    return {
      pagamentoStatus: 'PENDING',
      assinaturaStatus: 'PENDING_PAYMENT',
      isActive: false,
      isCancelled: false,
      originalStatus: normalized,
    };
  }

  private parseMetadata(metadata: unknown): ParsedReference {
    if (!metadata || typeof metadata !== 'object') {
      return {};
    }

    const source = metadata as Record<string, unknown>;

    return {
      assinaturaId: this.readStringField(source, [
        'assinaturaId',
        'assinatura_id',
      ]),
      pagamentoId: this.readStringField(source, [
        'pagamentoId',
        'pagamento_id',
      ]),
      userId: this.readStringField(source, [
        'userId',
        'usuario_id',
        'usuarioId',
      ]),
      planoId: this.readStringField(source, ['planoId', 'plano_id']),
      produtoId: this.readStringField(source, ['produtoId', 'produto_id']),
      preferenceId: this.readStringField(source, [
        'preferenceId',
        'preference_id',
      ]),
    };
  }

  private parseExternalReference(
    reference: string | undefined,
  ): ParsedReference {
    if (!reference || !reference.trim()) {
      return {};
    }

    const parsed: ParsedReference = {};

    for (const part of reference.split('|')) {
      const [rawKey, rawValue] = part.split(':');

      if (!rawKey || !rawValue) {
        continue;
      }

      const key = rawKey.trim().toLowerCase();
      const value = rawValue.trim();

      if (!value) {
        continue;
      }

      if (key === 'ass') {
        parsed.assinaturaId = value;
      } else if (key === 'pag') {
        parsed.pagamentoId = value;
      } else if (key === 'usr') {
        parsed.userId = value;
      } else if (key === 'pln') {
        parsed.planoId = value;
      } else if (key === 'prd') {
        parsed.produtoId = value;
      } else if (key === 'pref') {
        parsed.preferenceId = value;
      }
    }

    return parsed;
  }

  private buildExternalReference(reference: {
    assinaturaId: string;
    pagamentoId: string;
    userId: string;
    planoId: string;
  }): string {
    return `ass:${reference.assinaturaId}|pag:${reference.pagamentoId}|usr:${reference.userId}|pln:${reference.planoId}`;
  }

  private buildProductExternalReference(reference: {
    pagamentoId: string;
    userId: string;
    produtoId: string;
  }): string {
    return `pag:${reference.pagamentoId}|usr:${reference.userId}|prd:${reference.produtoId}`;
  }

  private validateMercadoPagoWebhookSignature(input: {
    headers: Record<string, unknown>;
    query: Record<string, unknown>;
    paymentId: string | null;
    preapprovalId: string | null;
  }): WebhookSignatureValidation {
    const webhookSecret = this.configService
      .get<string>('MP_WEBHOOK_SECRET')
      ?.trim();
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    const shouldEnforceByEnvironment =
      nodeEnv.trim().toLowerCase() === 'production';

    if (!webhookSecret) {
      if (shouldEnforceByEnvironment) {
        return {
          enforced: true,
          isValid: false,
          reason:
            'MP_WEBHOOK_SECRET nao configurado para validar assinatura do webhook em producao',
        };
      }

      return {
        enforced: false,
        isValid: null,
        reason: null,
      };
    }

    const signatureHeader = this.readHeaderValue(input.headers, 'x-signature');
    const requestId = this.readHeaderValue(input.headers, 'x-request-id');

    if (!signatureHeader) {
      return {
        enforced: true,
        isValid: false,
        reason: 'Header x-signature ausente',
      };
    }

    if (!requestId) {
      return {
        enforced: true,
        isValid: false,
        reason: 'Header x-request-id ausente',
      };
    }

    const signatureParts =
      this.parseMercadoPagoSignatureHeader(signatureHeader);

    if (!signatureParts) {
      return {
        enforced: true,
        isValid: false,
        reason: 'Header x-signature em formato invalido',
      };
    }

    const notificationId =
      input.paymentId ||
      input.preapprovalId ||
      this.readStringField(input.query, ['data.id', 'data_id', 'id']) ||
      null;

    if (!notificationId) {
      return {
        enforced: true,
        isValid: false,
        reason:
          'Nao foi possivel resolver id da notificacao para validar assinatura',
      };
    }

    const signatureManifest = `id:${notificationId};request-id:${requestId};ts:${signatureParts.ts};`;
    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(signatureManifest)
      .digest('hex');

    const receivedSignature = signatureParts.v1.toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(receivedSignature)) {
      return {
        enforced: true,
        isValid: false,
        reason: 'Assinatura recebida fora do padrao hex esperado',
      };
    }

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(receivedSignature, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length) {
      return {
        enforced: true,
        isValid: false,
        reason: 'Assinatura recebida com tamanho invalido',
      };
    }

    const isValid = timingSafeEqual(expectedBuffer, receivedBuffer);

    return {
      enforced: true,
      isValid,
      reason: isValid ? null : 'Assinatura HMAC invalida para o webhook',
    };
  }

  private parseMercadoPagoSignatureHeader(
    signatureHeader: string,
  ): { ts: string; v1: string } | null {
    const signatureMap = new Map<string, string>();

    for (const part of signatureHeader.split(',')) {
      const [key, ...rawValueParts] = part.split('=');

      if (!key || rawValueParts.length === 0) {
        continue;
      }

      const normalizedKey = key.trim().toLowerCase();
      const value = rawValueParts.join('=').trim();

      if (!normalizedKey || !value) {
        continue;
      }

      signatureMap.set(normalizedKey, value);
    }

    const ts = signatureMap.get('ts') ?? '';
    const v1 = signatureMap.get('v1') ?? '';

    if (!ts || !v1) {
      return null;
    }

    return { ts, v1 };
  }

  private readHeaderValue(
    headers: Record<string, unknown>,
    headerName: string,
  ): string | null {
    const normalizedTarget = headerName.trim().toLowerCase();

    if (!normalizedTarget) {
      return null;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (key.trim().toLowerCase() !== normalizedTarget) {
        continue;
      }

      return this.normalizeAnyToString(value);
    }

    return null;
  }

  private extractEventType(
    query: Record<string, unknown>,
    body: unknown,
  ): string | null {
    const bodyRecord = this.toRecord(body);

    return (
      this.readStringField(query, ['type', 'topic']) ||
      this.readStringField(bodyRecord, ['type', 'topic']) ||
      null
    );
  }

  private extractAction(
    body: unknown,
    query: Record<string, unknown>,
  ): string | null {
    const bodyRecord = this.toRecord(body);

    return (
      this.readStringField(bodyRecord, ['action']) ||
      this.readStringField(query, ['action']) ||
      null
    );
  }

  private extractWebhookExternalId(
    body: unknown,
    query: Record<string, unknown>,
  ): string | null {
    const bodyRecord = this.toRecord(body);

    return (
      this.readStringField(bodyRecord, ['id']) ||
      this.readStringField(query, ['id']) ||
      null
    );
  }

  private extractPaymentId(
    eventType: string | null,
    query: Record<string, unknown>,
    body: unknown,
  ): string | null {
    if (!this.isPaymentEvent(eventType)) {
      return null;
    }

    const bodyRecord = this.toRecord(body);
    const bodyData = this.toRecord(bodyRecord.data);

    const paymentFromBodyData = this.readStringField(bodyData, ['id']);
    if (paymentFromBodyData) {
      return paymentFromBodyData;
    }

    const paymentFromQueryData = this.readStringField(query, [
      'data.id',
      'data_id',
    ]);
    if (paymentFromQueryData) {
      return paymentFromQueryData;
    }

    if (eventType === 'payment') {
      return (
        this.readStringField(query, ['id']) ||
        this.readStringField(bodyRecord, ['id']) ||
        null
      );
    }

    return null;
  }

  private extractPreapprovalId(
    eventType: string | null,
    query: Record<string, unknown>,
    body: unknown,
  ): string | null {
    if (!this.isPreapprovalEvent(eventType)) {
      return null;
    }

    const bodyRecord = this.toRecord(body);
    const bodyData = this.toRecord(bodyRecord.data);

    return (
      this.readStringField(bodyData, ['id']) ||
      this.readStringField(query, ['data.id', 'data_id']) ||
      this.readStringField(query, ['id']) ||
      this.readStringField(bodyRecord, ['id']) ||
      null
    );
  }

  private isPaymentEvent(eventType: string | null): boolean {
    const normalized = (eventType || '').toLowerCase();
    return (
      normalized === 'payment' ||
      (normalized.includes('payment') && !normalized.includes('preapproval'))
    );
  }

  private isPreapprovalEvent(eventType: string | null): boolean {
    const normalized = (eventType || '').toLowerCase();
    return normalized.includes('preapproval');
  }

  private getMercadoPagoAccessToken(): string {
    const accessToken = this.configService
      .get<string>('MP_ACCESS_TOKEN')
      ?.trim();

    if (!accessToken) {
      throw new InternalServerErrorException('MP_ACCESS_TOKEN nao configurado');
    }

    return accessToken;
  }

  private getFrontendUrl(): string {
    return this.configService
      .get<string>('FRONTEND_URL', 'http://localhost:3000')
      .trim();
  }

  private getWebhookUrl(): string {
    const explicitWebhookUrl = this.configService
      .get<string>('MP_WEBHOOK_URL')
      ?.trim();

    if (explicitWebhookUrl) {
      return explicitWebhookUrl;
    }

    const backendPublicUrl = this.configService
      .get<string>('BACKEND_PUBLIC_URL')
      ?.trim();

    if (!backendPublicUrl) {
      throw new InternalServerErrorException(
        'Configure MP_WEBHOOK_URL ou BACKEND_PUBLIC_URL',
      );
    }

    return `${backendPublicUrl.replace(/\/+$/, '')}/pagamentos/mercado-pago/webhook`;
  }

  private buildAutoRecurringFromPlano(plano: Plano): MercadoPagoAutoRecurring {
    const amount = Number(plano.valor);

    if (Number.isNaN(amount) || amount <= 0) {
      throw new BadRequestException(
        'Valor do plano invalido para assinatura recorrente',
      );
    }

    const periodicidade = (plano.periodicidade_cobranca || '').toUpperCase();
    let frequencyType: 'days' | 'months' = 'months';
    let frequency = 1;

    if (periodicidade.includes('ANUAL')) {
      frequencyType = 'months';
      frequency = 12;
    } else if (periodicidade.includes('SEMANAL')) {
      frequencyType = 'days';
      frequency = 7;
    } else if (
      periodicidade.includes('DIARIA') ||
      periodicidade.includes('DIARIO')
    ) {
      frequencyType = 'days';
      frequency = 1;
    } else if (periodicidade.includes('MENSAL')) {
      frequencyType = 'months';
      frequency = 1;
    }

    let repetitions: number | undefined;

    if (
      frequencyType === 'months' &&
      plano.duracao_meses &&
      plano.duracao_meses > 0
    ) {
      repetitions = Math.max(1, Math.floor(plano.duracao_meses / frequency));
    } else if (
      frequencyType === 'days' &&
      plano.duracao_dias &&
      plano.duracao_dias > 0
    ) {
      repetitions = Math.max(1, Math.floor(plano.duracao_dias / frequency));
    }

    const autoRecurring: MercadoPagoAutoRecurring = {
      frequency,
      frequency_type: frequencyType,
      transaction_amount: Number(amount.toFixed(2)),
      currency_id: this.normalizeCurrencyForMercadoPago(plano.moeda),
    };

    if (typeof repetitions === 'number' && Number.isFinite(repetitions)) {
      autoRecurring.repetitions = repetitions;
    }

    return autoRecurring;
  }

  private normalizeCurrencyForMercadoPago(
    currency: string | null | undefined,
  ): string {
    const normalized = (currency || 'BRL').trim().toUpperCase();

    if (normalized === 'REAL' || normalized === 'R$' || normalized === 'BRL') {
      return 'BRL';
    }

    if (normalized.length === 3) {
      return normalized;
    }

    return 'BRL';
  }

  private normalizeDbCurrency(
    currency: string | null | undefined,
    fallback = 'BRL',
  ): string {
    const normalized = (currency || fallback).trim().toUpperCase();
    return normalized || fallback;
  }

  private normalizeAmount(
    amount: number | undefined,
    fallback = '0.00',
  ): string {
    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      return fallback;
    }

    return amount.toFixed(2);
  }

  private parseDate(value: string | undefined): Date | null {
    if (!value || !value.trim()) {
      return null;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed;
  }

  private normalizeAnyToString(value: unknown): string | null {
    if (Array.isArray(value) && value.length > 0) {
      const first = (value as unknown[])[0];

      if (typeof first === 'string' && first.trim().length > 0) {
        return first.trim();
      }

      if (typeof first === 'number' && Number.isFinite(first)) {
        return String(first);
      }
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }

  private async calculateNextChargeDate(
    planoId: string,
    fromDate: Date,
  ): Promise<Date | null> {
    try {
      const plano = await this.planosService.findOne(planoId);
      const baseDate = new Date(fromDate);

      if (typeof plano.duracao_meses === 'number' && plano.duracao_meses > 0) {
        const next = new Date(baseDate);
        next.setMonth(next.getMonth() + plano.duracao_meses);
        return next;
      }

      if (typeof plano.duracao_dias === 'number' && plano.duracao_dias > 0) {
        const next = new Date(baseDate);
        next.setDate(next.getDate() + plano.duracao_dias);
        return next;
      }

      const periodicidade = (plano.periodicidade_cobranca || '').toUpperCase();
      const next = new Date(baseDate);

      if (periodicidade.includes('ANUAL')) {
        next.setMonth(next.getMonth() + 12);
        return next;
      }

      if (periodicidade.includes('SEMANAL')) {
        next.setDate(next.getDate() + 7);
        return next;
      }

      if (
        periodicidade.includes('DIARIA') ||
        periodicidade.includes('DIARIO')
      ) {
        next.setDate(next.getDate() + 1);
        return next;
      }

      if (periodicidade.includes('MENSAL')) {
        next.setMonth(next.getMonth() + 1);
        return next;
      }

      return null;
    } catch {
      return null;
    }
  }

  private async createLog(params: {
    nivel: string;
    evento: string;
    descricao: string;
    usuarioId?: string | null;
    assinaturaId?: string | null;
    pagamentoId?: string | null;
    webhookId?: string | null;
    detalhes?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.logsRepository.save(
      this.logsRepository.create({
        usuario_id: params.usuarioId ?? null,
        assinatura_id: params.assinaturaId ?? null,
        pagamento_id: params.pagamentoId ?? null,
        webhook_id: params.webhookId ?? null,
        nivel: params.nivel,
        evento: params.evento,
        descricao: params.descricao,
        detalhes: params.detalhes ?? null,
      }),
    );
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private readStringField(
    source: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = source[key];

      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }

      if (Array.isArray(value) && value.length > 0) {
        const first = (value as unknown[])[0];

        if (typeof first === 'string' && first.trim().length > 0) {
          return first.trim();
        }
      }

      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }

    return undefined;
  }

  private normalizeErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message && error.message.trim()) {
      return error.message;
    }

    return fallback;
  }

  private resolveMercadoPagoError(
    payload: MercadoPagoPreferenceResponse | null,
    fallbackMessage: string,
  ): string {
    if (!payload || typeof payload !== 'object') {
      return fallbackMessage;
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }

    if (Array.isArray(payload.cause) && payload.cause.length > 0) {
      const causeDescription = payload.cause.find(
        (cause) =>
          typeof cause.description === 'string' &&
          cause.description.trim().length > 0,
      );

      if (typeof causeDescription?.description === 'string') {
        return causeDescription.description;
      }
    }

    return fallbackMessage;
  }
}
