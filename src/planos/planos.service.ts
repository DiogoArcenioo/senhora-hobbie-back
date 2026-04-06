import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Plano } from './entities/plano.entity';
import { CreateAssinaturaAdminDto } from './dto/create-assinatura-admin.dto';
import { UpdateAssinaturaAdminDto } from './dto/update-assinatura-admin.dto';

@Injectable()
export class PlanosService {
  constructor(
    @InjectRepository(Plano)
    private readonly planosRepository: Repository<Plano>,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
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

  async findAllAdmin(userId: string): Promise<Plano[]> {
    await this.assertAdminUser(userId);
    return this.findAll();
  }

  async findOneAdmin(userId: string, id: string): Promise<Plano> {
    await this.assertAdminUser(userId);
    return this.findOne(id);
  }

  async createAdmin(
    userId: string,
    dto: CreateAssinaturaAdminDto,
  ): Promise<Plano> {
    await this.assertAdminUser(userId);

    const plano = this.planosRepository.create({
      nome: this.requireText(dto.nome, 'Nome da assinatura obrigatorio'),
      descricao: this.optionalText(dto.descricao),
      tipo: this.normalizeUpperText(dto.tipo, 'ASSINATURA', 60),
      valor: this.normalizeValor(dto.valor),
      moeda: this.normalizeUpperText(dto.moeda, 'BRL', 12),
      periodicidade_cobranca: this.normalizeUpperText(
        dto.periodicidade_cobranca,
        'MENSAL',
        60,
      ),
      duracao_dias: this.normalizeOptionalInteger(dto.duracao_dias),
      duracao_meses: this.normalizeOptionalInteger(dto.duracao_meses),
      ativo: this.normalizeBoolean(dto.ativo, true),
    });

    this.validateDuracao(plano.duracao_dias, plano.duracao_meses);

    return this.planosRepository.save(plano);
  }

  async updateAdmin(
    userId: string,
    id: string,
    dto: UpdateAssinaturaAdminDto,
  ): Promise<Plano> {
    await this.assertAdminUser(userId);

    const plano = await this.findOne(id);

    if (dto.nome !== undefined) {
      plano.nome = this.requireText(dto.nome, 'Nome da assinatura obrigatorio');
    }

    if (dto.descricao !== undefined) {
      plano.descricao = this.optionalText(dto.descricao);
    }

    if (dto.tipo !== undefined) {
      plano.tipo = this.normalizeUpperText(dto.tipo, plano.tipo, 60);
    }

    if (dto.valor !== undefined) {
      plano.valor = this.normalizeValor(dto.valor);
    }

    if (dto.moeda !== undefined) {
      plano.moeda = this.normalizeUpperText(dto.moeda, plano.moeda, 12);
    }

    if (dto.periodicidade_cobranca !== undefined) {
      plano.periodicidade_cobranca = this.normalizeUpperText(
        dto.periodicidade_cobranca,
        plano.periodicidade_cobranca,
        60,
      );
    }

    if (dto.duracao_dias !== undefined) {
      plano.duracao_dias = this.normalizeOptionalInteger(dto.duracao_dias);
    }

    if (dto.duracao_meses !== undefined) {
      plano.duracao_meses = this.normalizeOptionalInteger(dto.duracao_meses);
    }

    if (dto.ativo !== undefined) {
      plano.ativo = this.normalizeBoolean(dto.ativo, plano.ativo);
    }

    this.validateDuracao(plano.duracao_dias, plano.duracao_meses);

    return this.planosRepository.save(plano);
  }

  async removeAdmin(userId: string, id: string): Promise<{ message: string }> {
    await this.assertAdminUser(userId);

    const plano = await this.findOne(id);
    plano.ativo = false;
    await this.planosRepository.save(plano);

    return { message: 'Assinatura inativada com sucesso' };
  }

  private async assertAdminUser(userId: string): Promise<void> {
    const normalizedUserId = userId.trim();

    if (!normalizedUserId) {
      throw new ForbiddenException('Usuario nao autenticado');
    }

    const usuario = await this.usuariosRepository.findOne({
      where: { id: normalizedUserId },
    });

    if (!usuario || !usuario.ativo || usuario.tipo !== 'ADM') {
      throw new ForbiddenException('Acesso permitido apenas para admin');
    }
  }

  private requireText(value: unknown, errorMessage: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(errorMessage);
    }

    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException(errorMessage);
    }

    return normalized;
  }

  private optionalText(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('Descricao invalida');
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeUpperText(
    value: unknown,
    fallback: string,
    maxLength: number,
  ): string {
    if (value === undefined || value === null) {
      return fallback.trim().toUpperCase().slice(0, maxLength);
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('Campo textual invalido');
    }

    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException('Campo textual vazio');
    }

    return normalized.toUpperCase().slice(0, maxLength);
  }

  private normalizeValor(value: unknown): string {
    if (value === undefined || value === null) {
      throw new BadRequestException('Valor da assinatura obrigatorio');
    }

    let parsedValue = Number.NaN;

    if (typeof value === 'number') {
      parsedValue = value;
    } else if (typeof value === 'string') {
      parsedValue = Number(value.replace(',', '.'));
    }

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException('Valor da assinatura invalido');
    }

    return parsedValue.toFixed(2);
  }

  private normalizeOptionalInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    let parsedValue = Number.NaN;

    if (typeof value === 'number') {
      parsedValue = value;
    } else if (typeof value === 'string') {
      parsedValue = Number(value.trim());
    }

    if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException('Duracao invalida');
    }

    return parsedValue;
  }

  private normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null) {
      return fallback;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();

      if (normalized === 'true') {
        return true;
      }

      if (normalized === 'false') {
        return false;
      }
    }

    throw new BadRequestException('Campo ativo invalido');
  }

  private validateDuracao(
    duracaoDias: number | null,
    duracaoMeses: number | null,
  ): void {
    if (
      typeof duracaoDias === 'number' &&
      duracaoDias > 0 &&
      typeof duracaoMeses === 'number' &&
      duracaoMeses > 0
    ) {
      throw new BadRequestException(
        'Informe duracao em dias ou meses, nao ambos',
      );
    }
  }
}
