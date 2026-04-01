import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanosModule } from '../planos/planos.module';
import { Assinatura } from './entities/assinatura.entity';
import { LogPagamento } from './entities/log-pagamento.entity';
import { Pagamento } from './entities/pagamento.entity';
import { WebhookPagamento } from './entities/webhook-pagamento.entity';
import { PagamentosController } from './pagamentos.controller';
import { PagamentosService } from './pagamentos.service';

@Module({
  imports: [
    PlanosModule,
    TypeOrmModule.forFeature([
      Assinatura,
      Pagamento,
      WebhookPagamento,
      LogPagamento,
    ]),
  ],
  controllers: [PagamentosController],
  providers: [PagamentosService],
})
export class PagamentosModule {}
