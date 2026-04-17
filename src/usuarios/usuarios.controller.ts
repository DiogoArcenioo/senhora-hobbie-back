import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { VendasProdutosService } from '../pagamentos/vendas-produtos.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { EnderecoUsuarioDto } from './dto/endereco-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { UsuariosService } from './usuarios.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('usuarios')
export class UsuariosController {
  constructor(
    private readonly usuariosService: UsuariosService,
    private readonly vendasProdutosService: VendasProdutosService,
  ) {}

  @Public()
  @Post()
  create(@Body() createUsuarioDto: CreateUsuarioDto) {
    return this.usuariosService.createPublic(createUsuarioDto);
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.usuariosService.findAll(this.getAuthenticatedUserId(req));
  }

  @Get('me/endereco')
  getMeuEndereco(@Req() req: AuthenticatedRequest) {
    return this.usuariosService.getMeuEndereco(
      this.getAuthenticatedUserId(req),
    );
  }

  @Put('me/endereco')
  atualizarMeuEndereco(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnderecoUsuarioDto,
  ) {
    return this.usuariosService.atualizarMeuEndereco(
      this.getAuthenticatedUserId(req),
      dto,
    );
  }

  @Get('me/compras')
  getMinhasCompras(@Req() req: AuthenticatedRequest) {
    return this.vendasProdutosService.listarMinhasCompras(
      this.getAuthenticatedUserId(req),
    );
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.usuariosService.findOne(id, this.getAuthenticatedUserId(req));
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
  ) {
    return this.usuariosService.update(
      id,
      updateUsuarioDto,
      this.getAuthenticatedUserId(req),
    );
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.usuariosService.remove(id, this.getAuthenticatedUserId(req));
  }

  private getAuthenticatedUserId(req: AuthenticatedRequest): string {
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!userId || !userId.trim()) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId.trim();
  }
}
