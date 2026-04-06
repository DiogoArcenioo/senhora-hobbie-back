import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanosModule } from '../planos/planos.module';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AssinaturasGestaoController } from './assinaturas-gestao.controller';
import { AssinaturasGestaoService } from './assinaturas-gestao.service';
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
      Usuario,
    ]),
  ],
  controllers: [PagamentosController, AssinaturasGestaoController],
  providers: [PagamentosService, AssinaturasGestaoService],
})
export class PagamentosModule {}
