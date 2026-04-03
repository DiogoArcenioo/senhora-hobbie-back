import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { EventosService } from './eventos.service';

type RequestComUsuario = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('eventos')
export class EventosController {
  constructor(private readonly eventosService: EventosService) {}

  @Public()
  @Get('public')
  listarEventosPublicos() {
    return this.eventosService.listarEventosPublicos();
  }

  @Public()
  @Get('public/:id/album')
  obterAlbumPublico(@Param('id') id: string) {
    return this.eventosService.obterAlbumPublico(id);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'capa', maxCount: 1 },
        { name: 'fotos', maxCount: 60 },
      ],
      {
        limits: {
          fileSize: 10 * 1024 * 1024,
          files: 61,
        },
      },
    ),
  )
  async criarEvento(
    @Req() request: RequestComUsuario,
    @Body() body: Record<string, string | undefined>,
    @UploadedFiles()
    files: {
      capa?: Express.Multer.File[];
      fotos?: Express.Multer.File[];
    },
  ) {
    const usuarioId = request.user?.userId;

    if (!usuarioId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    const evento = await this.eventosService.criarEventoComImagens(
      usuarioId,
      body,
      files,
    );

    return {
      evento,
    };
  }
}
