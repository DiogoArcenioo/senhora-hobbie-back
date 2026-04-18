import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Assinatura } from './entities/assinatura.entity';
import { LogPagamento } from './entities/log-pagamento.entity';
import { PagamentosService } from './pagamentos.service';

@Injectable()
export class AssinaturasCobrancaScheduler {
  private readonly logger = new Logger(AssinaturasCobrancaScheduler.name);
  private isRunning = false;

  constructor(
    private readonly pagamentosService: PagamentosService,
    @InjectRepository(Assinatura)
    private readonly assinaturasRepository: Repository<Assinatura>,
    @InjectRepository(LogPagamento)
    private readonly logsRepository: Repository<LogPagamento>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'assinaturas-cobranca-diaria',
    timeZone: 'America/Sao_Paulo',
  })
  async runDailyBillingSync(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Execucao anterior ainda em andamento, pulando ciclo');
      return;
    }

    this.isRunning = true;

    try {
      await this.syncRecurringSubscriptions();
      await this.markExpiredSubscriptions();
    } catch (error) {
      this.logger.error(
        'Erro no ciclo diario de cobranca',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async syncRecurringSubscriptions(): Promise<void> {
    const candidatas = await this.assinaturasRepository.find({
      where: [
        {
          gateway: 'MERCADO_PAGO_SUBSCRIPTION',
          gateway_assinatura_id: Not(IsNull()),
          status: 'ACTIVE',
        },
        {
          gateway: 'MERCADO_PAGO_SUBSCRIPTION',
          gateway_assinatura_id: Not(IsNull()),
          status: 'PENDING_PAYMENT',
        },
        {
          gateway: 'MERCADO_PAGO_SUBSCRIPTION',
          gateway_assinatura_id: Not(IsNull()),
          status: 'PAUSED',
        },
      ],
      take: 200,
    });

    this.logger.log(
      `Sincronizando ${candidatas.length} assinatura(s) recorrente(s)`,
    );

    for (const assinatura of candidatas) {
      if (!assinatura.gateway_assinatura_id) {
        continue;
      }

      try {
        await this.pagamentosService.syncSubscriptionFromGateway(
          assinatura.gateway_assinatura_id,
        );
      } catch (error) {
        const mensagem =
          error instanceof Error ? error.message : 'Erro desconhecido';

        this.logger.warn(
          `Falha ao sincronizar assinatura ${assinatura.id}: ${mensagem}`,
        );

        await this.logsRepository
          .save(
            this.logsRepository.create({
              usuario_id: assinatura.usuario_id ?? null,
              assinatura_id: assinatura.id,
              pagamento_id: null,
              webhook_id: null,
              nivel: 'WARN',
              evento: 'COBRANCA_SCHEDULER_FALHA',
              descricao: `Falha ao sincronizar assinatura ${assinatura.id}`,
              detalhes: {
                gateway_assinatura_id: assinatura.gateway_assinatura_id,
                erro: mensagem,
              },
            }),
          )
          .catch(() => undefined);
      }
    }
  }

  private async markExpiredSubscriptions(): Promise<void> {
    const hoje = new Date();
    const vencidas = await this.assinaturasRepository.find({
      where: {
        status: 'ACTIVE',
        cancelado_em: IsNull(),
        data_fim: LessThanOrEqual(hoje),
      },
      take: 500,
    });

    if (vencidas.length === 0) {
      return;
    }

    this.logger.log(
      `Marcando ${vencidas.length} assinatura(s) como EXPIRED por data_fim`,
    );

    for (const assinatura of vencidas) {
      assinatura.status = 'EXPIRED';
      assinatura.observacoes = 'Assinatura expirada automaticamente';

      try {
        await this.assinaturasRepository.save(assinatura);
        await this.logsRepository.save(
          this.logsRepository.create({
            usuario_id: assinatura.usuario_id ?? null,
            assinatura_id: assinatura.id,
            pagamento_id: null,
            webhook_id: null,
            nivel: 'INFO',
            evento: 'ASSINATURA_EXPIRADA',
            descricao: `Assinatura ${assinatura.id} expirada automaticamente`,
            detalhes: {
              data_fim: assinatura.data_fim?.toISOString() ?? null,
            },
          }),
        );
      } catch (error) {
        this.logger.warn(
          `Falha ao expirar assinatura ${assinatura.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
