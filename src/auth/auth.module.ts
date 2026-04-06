import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { type StringValue } from 'ms';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

function getRequiredJwtSecret(configService: ConfigService): string {
  const jwtSecret = configService.get<string>('JWT_SECRET')?.trim();

  if (!jwtSecret) {
    throw new Error('Variavel de ambiente obrigatoria ausente: JWT_SECRET');
  }

  return jwtSecret;
}

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get<string>(
          'JWT_EXPIRES_IN',
          '1d',
        ) as StringValue;

        return {
          secret: getRequiredJwtSecret(configService),
          signOptions: {
            expiresIn,
          },
        };
      },
    }),
    TypeOrmModule.forFeature([Usuario]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
