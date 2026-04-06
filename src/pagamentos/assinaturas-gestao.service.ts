import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Assinatura } from './entities/assinatura.entity';

type AssinaturaGestaoRaw = {
  assinatura_id: string;
  assinatura_status: string;
  usuario_id: string;
  usuario_nome: string | null;
  usuario_email: string | null;
  plano_id: string | null;
  plano_nome: string | null;
  plano_valor: string | null;
  plano_moeda: string | null;
  data_inicio: Date | string | null;
  proxima_cobranca_em: Date | string | null;
  created_at: Date | string;
};

type AssinaturaGestaoItem = {
  id: string;
  status: string;
  usuarioId: string;
  usuarioNome: string;
  usuarioEmail: string | null;
  planoId: string | null;
  planoNome: string;
  planoValor: string | null;
  planoMoeda: string | null;
  dataInicio: string | null;
  proximaCobrancaEm: string | null;
  createdAt: string;
};

type GestaoAssinaturasResponse = {
  resumo: {
    assinaturasAtivas: number;
    novasAssinaturasMesAtual: number;
    mesReferencia: string;
  };
  assinaturasAtivas: AssinaturaGestaoItem[];
  novasAssinaturasMesAtual: AssinaturaGestaoItem[];
};

@Injectable()
export class AssinaturasGestaoService {
  constructor(
    @InjectRepository(Assinatura)
    private readonly assinaturasRepository: Repository<Assinatura>,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
  ) {}

  async getDashboard(userId: string): Promise<GestaoAssinaturasResponse> {
    await this.assertAdminUser(userId);

    const mesReferencia = this.resolveReferenceMonth();
    const [assinaturasAtivas, novasAssinaturasMesAtual] = await Promise.all([
      this.loadActiveSubscriptions(),
      this.loadNewSubscriptionsForMonth(mesReferencia),
    ]);

    return {
      resumo: {
        assinaturasAtivas: assinaturasAtivas.length,
        novasAssinaturasMesAtual: novasAssinaturasMesAtual.length,
        mesReferencia,
      },
      assinaturasAtivas,
      novasAssinaturasMesAtual,
    };
  }

  private resolveReferenceMonth(): string {
    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());

    const year = dateParts.find((part) => part.type === 'year')?.value ?? '';
    const month = dateParts.find((part) => part.type === 'month')?.value ?? '';

    if (!year || !month) {
      const now = new Date();
      const fallbackYear = String(now.getUTCFullYear());
      const fallbackMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
      return `${fallbackYear}-${fallbackMonth}`;
    }

    return `${year}-${month}`;
  }

  private async loadActiveSubscriptions(): Promise<AssinaturaGestaoItem[]> {
    const rawRows = await this.assinaturasRepository
      .createQueryBuilder('assinatura')
      .leftJoin('usuarios', 'usuario', 'usuario.id = assinatura.usuario_id')
      .leftJoin('planos', 'plano', 'plano.id = assinatura.plano_id')
      .select([
        'assinatura.id AS assinatura_id',
        'assinatura.status AS assinatura_status',
        'assinatura.usuario_id AS usuario_id',
        'usuario.nome AS usuario_nome',
        'usuario.email AS usuario_email',
        'plano.id AS plano_id',
        'plano.nome AS plano_nome',
        'plano.valor AS plano_valor',
        'plano.moeda AS plano_moeda',
        'assinatura.data_inicio AS data_inicio',
        'assinatura.proxima_cobranca_em AS proxima_cobranca_em',
        'assinatura.created_at AS created_at',
      ])
      .where('assinatura.status = :status', { status: 'ACTIVE' })
      .andWhere('assinatura.cancelado_em IS NULL')
      .orderBy(
        'COALESCE(assinatura.data_inicio, assinatura.created_at)',
        'DESC',
      )
      .addOrderBy('assinatura.id', 'DESC')
      .getRawMany<AssinaturaGestaoRaw>();

    return rawRows.map((row) => this.toGestaoItem(row));
  }

  private async loadNewSubscriptionsForMonth(
    mesReferencia: string,
  ): Promise<AssinaturaGestaoItem[]> {
    const rawRows = await this.assinaturasRepository
      .createQueryBuilder('assinatura')
      .leftJoin('usuarios', 'usuario', 'usuario.id = assinatura.usuario_id')
      .leftJoin('planos', 'plano', 'plano.id = assinatura.plano_id')
      .select([
        'assinatura.id AS assinatura_id',
        'assinatura.status AS assinatura_status',
        'assinatura.usuario_id AS usuario_id',
        'usuario.nome AS usuario_nome',
        'usuario.email AS usuario_email',
        'plano.id AS plano_id',
        'plano.nome AS plano_nome',
        'plano.valor AS plano_valor',
        'plano.moeda AS plano_moeda',
        'assinatura.data_inicio AS data_inicio',
        'assinatura.proxima_cobranca_em AS proxima_cobranca_em',
        'assinatura.created_at AS created_at',
      ])
      .where('assinatura.status = :status', { status: 'ACTIVE' })
      .andWhere('assinatura.cancelado_em IS NULL')
      .andWhere(
        `to_char(assinatura.data_inicio AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = :mesReferencia`,
        { mesReferencia },
      )
      .orderBy('assinatura.data_inicio', 'DESC')
      .addOrderBy('assinatura.id', 'DESC')
      .getRawMany<AssinaturaGestaoRaw>();

    return rawRows.map((row) => this.toGestaoItem(row));
  }

  private toGestaoItem(raw: AssinaturaGestaoRaw): AssinaturaGestaoItem {
    return {
      id: raw.assinatura_id,
      status: raw.assinatura_status,
      usuarioId: raw.usuario_id,
      usuarioNome:
        typeof raw.usuario_nome === 'string' && raw.usuario_nome.trim()
          ? raw.usuario_nome.trim()
          : 'Usuario sem nome',
      usuarioEmail:
        typeof raw.usuario_email === 'string' && raw.usuario_email.trim()
          ? raw.usuario_email.trim()
          : null,
      planoId:
        typeof raw.plano_id === 'string' && raw.plano_id.trim()
          ? raw.plano_id.trim()
          : null,
      planoNome:
        typeof raw.plano_nome === 'string' && raw.plano_nome.trim()
          ? raw.plano_nome.trim()
          : 'Plano nao identificado',
      planoValor:
        typeof raw.plano_valor === 'string' && raw.plano_valor.trim()
          ? raw.plano_valor
          : null,
      planoMoeda:
        typeof raw.plano_moeda === 'string' && raw.plano_moeda.trim()
          ? raw.plano_moeda.trim().toUpperCase()
          : null,
      dataInicio: this.toIsoString(raw.data_inicio),
      proximaCobrancaEm: this.toIsoString(raw.proxima_cobranca_em),
      createdAt: this.toIsoString(raw.created_at) ?? new Date().toISOString(),
    };
  }

  private toIsoString(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    const parsedDate = value instanceof Date ? value : new Date(String(value));

    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate.toISOString();
  }

  private async assertAdminUser(userId: string): Promise<void> {
    const normalizedUserId = userId.trim();

    if (!normalizedUserId) {
      throw new ForbiddenException('Usuario nao autenticado');
    }

    const usuario = await this.usuariosRepository.findOne({
      where: { id: normalizedUserId },
    });

    const isAdmin =
      !!usuario &&
      usuario.ativo &&
      typeof usuario.tipo === 'string' &&
      usuario.tipo.trim().toUpperCase() === 'ADM';

    if (!isAdmin) {
      throw new ForbiddenException('Acesso permitido apenas para admin');
    }
  }
}
