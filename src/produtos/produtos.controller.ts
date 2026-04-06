import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ProdutosService } from './produtos.service';

type RequestComUsuario = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('produtos')
export class ProdutosController {
  constructor(private readonly produtosService: ProdutosService) {}

  @Public()
  @Get('public')
  listarPublicos() {
    return this.produtosService.listarProdutosPublicos();
  }

  @Public()
  @Get('public/:id')
  obterPublico(@Param('id') id: string) {
    return this.produtosService.obterProdutoPublico(id);
  }

  @Get()
  listarAdmin(@Req() request: RequestComUsuario) {
    const userId = this.requireUserId(request);
    return this.produtosService.listarProdutosAdmin(userId);
  }

  @Get(':id')
  obterAdmin(@Req() request: RequestComUsuario, @Param('id') id: string) {
    const userId = this.requireUserId(request);
    return this.produtosService.obterProdutoAdmin(userId, id);
  }

  @Post()
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'capa', maxCount: 1 },
        { name: 'fotos', maxCount: 30 },
      ],
      {
        limits: {
          files: 31,
          fileSize: 25 * 1024 * 1024,
        },
      },
    ),
  )
  criarProduto(
    @Req() request: RequestComUsuario,
    @Body() body: Record<string, string | undefined>,
    @UploadedFiles()
    files: {
      capa?: Express.Multer.File[];
      fotos?: Express.Multer.File[];
    },
  ) {
    const userId = this.requireUserId(request);
    return this.produtosService.criarProdutoComImagens(userId, body, files);
  }

  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'capa', maxCount: 1 },
        { name: 'fotos', maxCount: 30 },
      ],
      {
        limits: {
          files: 31,
          fileSize: 25 * 1024 * 1024,
        },
      },
    ),
  )
  atualizarProduto(
    @Req() request: RequestComUsuario,
    @Param('id') id: string,
    @Body() body: Record<string, string | undefined>,
    @UploadedFiles()
    files: {
      capa?: Express.Multer.File[];
      fotos?: Express.Multer.File[];
    },
  ) {
    const userId = this.requireUserId(request);
    return this.produtosService.atualizarProdutoComImagens(
      userId,
      id,
      body,
      files,
    );
  }

  @Delete(':id')
  removerProduto(@Req() request: RequestComUsuario, @Param('id') id: string) {
    const userId = this.requireUserId(request);
    return this.produtosService.removerProduto(userId, id);
  }

  @Delete(':id/fotos/:fotoId')
  removerFotoProduto(
    @Req() request: RequestComUsuario,
    @Param('id') id: string,
    @Param('fotoId') fotoId: string,
  ) {
    const userId = this.requireUserId(request);
    return this.produtosService.removerFotoProduto(userId, id, fotoId);
  }

  private requireUserId(request: RequestComUsuario): string {
    const userId = request.user?.userId;

    if (!userId || !userId.trim()) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId.trim();
  }
}
