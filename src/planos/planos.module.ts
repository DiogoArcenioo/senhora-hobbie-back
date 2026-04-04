import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AssinaturasAdminController } from './assinaturas-admin.controller';
import { Plano } from './entities/plano.entity';
import { PlanosController } from './planos.controller';
import { PlanosService } from './planos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Plano, Usuario])],
  controllers: [PlanosController, AssinaturasAdminController],
  providers: [PlanosService],
  exports: [PlanosService],
})
export class PlanosModule {}
