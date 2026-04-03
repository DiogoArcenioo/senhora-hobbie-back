import {
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ImagensService } from './imagens.service';

type RequestComUsuario = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('imagens/site')
export class ImagensController {
  constructor(private readonly imagensService: ImagensService) {}

  @Public()
  @Get('home-destaque')
  async obterHomeDestaque() {
    const imagem = await this.imagensService.obterImagemHomeDestaque();

    return {
      imagem,
    };
  }

  @Post('home-destaque')
  @UseInterceptors(
    FileInterceptor('arquivo', {
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadHomeDestaque(
    @Req() request: RequestComUsuario,
    @UploadedFile() arquivo: Express.Multer.File,
  ) {
    const usuarioId = request.user?.userId;

    if (!usuarioId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    const imagem = await this.imagensService.uploadImagemHomeDestaque(
      usuarioId,
      arquivo,
    );

    return {
      imagem,
    };
  }
}
