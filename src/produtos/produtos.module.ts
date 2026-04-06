import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Imagem } from '../imagens/entities/imagem.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { ProdutoImagem } from './entities/produto-imagem.entity';
import { Produto } from './entities/produto.entity';
import { ProdutosController } from './produtos.controller';
import { ProdutosService } from './produtos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Produto, ProdutoImagem, Imagem, Usuario]),
  ],
  controllers: [ProdutosController],
  providers: [ProdutosService],
})
export class ProdutosModule {}
