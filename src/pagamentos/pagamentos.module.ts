import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanosModule } from '../planos/planos.module';
import { Produto } from '../produtos/entities/produto.entity';
import { EnderecoUsuario } from '../usuarios/entities/endereco-usuario.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AssinaturasGestaoController } from './assinaturas-gestao.controller';
import { AssinaturasGestaoService } from './assinaturas-gestao.service';
import { Assinatura } from './entities/assinatura.entity';
import { LogPagamento } from './entities/log-pagamento.entity';
import { Pagamento } from './entities/pagamento.entity';
import { VendaProduto } from './entities/venda-produto.entity';
import { WebhookPagamento } from './entities/webhook-pagamento.entity';
import { PagamentosController } from './pagamentos.controller';
import { PagamentosService } from './pagamentos.service';
import { VendasGestaoController } from './vendas-gestao.controller';
import { VendasGestaoService } from './vendas-gestao.service';
import { VendasProdutosService } from './vendas-produtos.service';

@Module({
  imports: [
    PlanosModule,
    TypeOrmModule.forFeature([
      Assinatura,
      Pagamento,
      WebhookPagamento,
      LogPagamento,
      Usuario,
      EnderecoUsuario,
      Produto,
      VendaProduto,
    ]),
  ],
  controllers: [
    PagamentosController,
    AssinaturasGestaoController,
    VendasGestaoController,
  ],
  providers: [
    PagamentosService,
    AssinaturasGestaoService,
    VendasGestaoService,
    VendasProdutosService,
  ],
  exports: [VendasProdutosService],
})
export class PagamentosModule {}
