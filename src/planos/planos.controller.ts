import { Controller, Get, Param } from '@nestjs/common';
import { PlanosService } from './planos.service';

@Controller('planos')
export class PlanosController {
  constructor(private readonly planosService: PlanosService) {}

  @Get()
  findAll() {
    return this.planosService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.planosService.findOne(id);
  }
}
