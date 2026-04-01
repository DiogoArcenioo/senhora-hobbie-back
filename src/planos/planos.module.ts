import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plano } from './entities/plano.entity';
import { PlanosController } from './planos.controller';
import { PlanosService } from './planos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Plano])],
  controllers: [PlanosController],
  providers: [PlanosService],
  exports: [PlanosService],
})
export class PlanosModule {}
