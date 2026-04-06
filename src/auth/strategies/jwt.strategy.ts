import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
  type JwtFromRequestFunction,
} from 'passport-jwt';

type JwtPayload = {
  sub: string;
  email: string;
  tipo?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const jwtSecret = configService.get<string>('JWT_SECRET')?.trim();

    if (!jwtSecret) {
      throw new Error('Variavel de ambiente obrigatoria ausente: JWT_SECRET');
    }
    const jwtExtractorFactory = (
      ExtractJwt as unknown as {
        fromAuthHeaderAsBearerToken: () => JwtFromRequestFunction;
      }
    ).fromAuthHeaderAsBearerToken;
    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
    const jwtFromRequest = jwtExtractorFactory();

    super({
      jwtFromRequest,
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
  }

  validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      email: payload.email,
      tipo: payload.tipo,
    };
  }
}
