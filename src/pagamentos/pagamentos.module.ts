import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanosModule } from '../planos/planos.module';
import { Produto } from '../produtos/entities/produto.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AssinaturasGestaoController } from './assinaturas-gestao.controller';
import { AssinaturasGestaoService } from './assinaturas-gestao.service';
import { Assinatura } from './entities/assinatura.entity';
import { LogPagamento } from './entities/log-pagamento.entity';
import { Pagamento } from './entities/pagamento.entity';
import { WebhookPagamento } from './entities/webhook-pagamento.entity';
import { PagamentosController } from './pagamentos.controller';
import { PagamentosService } from './pagamentos.service';
import { VendasGestaoController } from './vendas-gestao.controller';
import { VendasGestaoService } from './vendas-gestao.service';

@Module({
  imports: [
    PlanosModule,
    TypeOrmModule.forFeature([
      Assinatura,
      Pagamento,
      WebhookPagamento,
      LogPagamento,
      Usuario,
      Produto,
    ]),
  ],
  controllers: [
    PagamentosController,
    AssinaturasGestaoController,
    VendasGestaoController,
  ],
  providers: [PagamentosService, AssinaturasGestaoService, VendasGestaoService],
})
export class PagamentosModule {}
