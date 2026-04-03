import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseBootstrapService } from './database/database-bootstrap.service';
import { EventosModule } from './eventos/eventos.module';
import { ImagensModule } from './imagens/imagens.module';
import { PagamentosModule } from './pagamentos/pagamentos.module';
import { PlanosModule } from './planos/planos.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const getRequiredEnv = (key: string): string => {
          const value = configService.get<string>(key);

          if (!value || value.trim().length === 0) {
            throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
          }

          return value.trim();
        };

        const synchronize =
          configService.get<string>('DB_SYNCHRONIZE') === 'true';
        const ssl =
          configService.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false;
        const port = Number(getRequiredEnv('DB_PORT'));

        if (Number.isNaN(port)) {
          throw new Error('Variavel de ambiente DB_PORT precisa ser numerica');
        }

        return {
          type: 'postgres',
          host: getRequiredEnv('DB_HOST'),
          port,
          username: getRequiredEnv('DB_USER'),
          password: getRequiredEnv('DB_PASSWORD'),
          database: getRequiredEnv('DB_NAME'),
          autoLoadEntities: true,
          synchronize,
          ssl,
        };
      },
    }),
    AuthModule,
    EventosModule,
    ImagensModule,
    PagamentosModule,
    PlanosModule,
    UsuariosModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    DatabaseBootstrapService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
