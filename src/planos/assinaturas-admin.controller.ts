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
} from '@nestjs/common';
import { Request } from 'express';
import { CreateAssinaturaAdminDto } from './dto/create-assinatura-admin.dto';
import { UpdateAssinaturaAdminDto } from './dto/update-assinatura-admin.dto';
import { PlanosService } from './planos.service';

type AuthenticatedRequest = Request & {
  user?: {
    userId?: string;
  };
};

@Controller('assinaturas')
export class AssinaturasAdminController {
  constructor(private readonly planosService: PlanosService) {}

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    const userId = this.getUserId(req);
    return this.planosService.findAllAdmin(userId);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.planosService.findOneAdmin(userId, id);
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateAssinaturaAdminDto,
  ) {
    const userId = this.getUserId(req);
    return this.planosService.createAdmin(userId, body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateAssinaturaAdminDto,
  ) {
    const userId = this.getUserId(req);
    return this.planosService.updateAdmin(userId, id, body);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const userId = this.getUserId(req);
    return this.planosService.removeAdmin(userId, id);
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userId = typeof req.user?.userId === 'string' ? req.user.userId : '';

    if (!userId) {
      throw new UnauthorizedException('Usuario nao autenticado');
    }

    return userId;
  }
}
