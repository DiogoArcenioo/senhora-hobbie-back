import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plano } from './entities/plano.entity';

@Injectable()
export class PlanosService {
  constructor(
    @InjectRepository(Plano)
    private readonly planosRepository: Repository<Plano>,
  ) {}

  async findAll(): Promise<Plano[]> {
    return this.planosRepository.find({
      order: { id: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Plano> {
    const plano = await this.planosRepository.findOne({ where: { id } });

    if (!plano) {
      throw new NotFoundException(`Plano com id ${id} nao encontrado`);
    }

    return plano;
  }
}
