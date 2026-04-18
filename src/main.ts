import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false,
    }),
  );

  const allowedOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  const isProduction =
    (process.env.NODE_ENV ?? 'development').toLowerCase() === 'production';

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length > 0) {
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origem nao permitida pelo CORS'), false);
        }
        return;
      }

      if (isProduction) {
        callback(new Error('CORS_ALLOWED_ORIGINS nao configurado'), false);
        return;
      }

      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    maxAge: 3600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  const httpAdapter = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
  };
  httpAdapter.set?.('trust proxy', 1);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(Number.isFinite(port) ? port : 3001);
}
void bootstrap();
