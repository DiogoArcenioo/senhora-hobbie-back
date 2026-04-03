import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { ImagensController } from './imagens.controller';
import { ImagensService } from './imagens.service';
import { Imagem } from './entities/imagem.entity';
import { SiteImagem } from './entities/site-imagem.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Imagem, SiteImagem, Usuario])],
  controllers: [ImagensController],
  providers: [ImagensService],
  exports: [ImagensService],
})
export class ImagensModule {}
