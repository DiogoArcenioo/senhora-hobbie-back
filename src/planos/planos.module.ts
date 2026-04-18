import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AssinaturasAdminController } from './assinaturas-admin.controller';
import { Plano } from './entities/plano.entity';
import { PlanosController } from './planos.controller';
import { PlanosService } from './planos.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    TypeOrmModule.forFeature([Plano, Usuario]),
  ],
  controllers: [PlanosController, AssinaturasAdminController],
  providers: [PlanosService],
  exports: [PlanosService],
})
export class PlanosModule {}
