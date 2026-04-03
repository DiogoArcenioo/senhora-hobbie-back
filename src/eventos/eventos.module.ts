import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Imagem } from '../imagens/entities/imagem.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { EventosController } from './eventos.controller';
import { EventosService } from './eventos.service';
import { EventoImagem } from './entities/evento-imagem.entity';
import { Evento } from './entities/evento.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Evento, EventoImagem, Imagem, Usuario])],
  controllers: [EventosController],
  providers: [EventosService],
  exports: [EventosService],
})
export class EventosModule {}
