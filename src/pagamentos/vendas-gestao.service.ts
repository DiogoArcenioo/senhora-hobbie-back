import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Pagamento } from './entities/pagamento.entity';

type VendaRaw = {
  pagamento_id: string;
  pagamento_valor: string | null;
  pagamento_moeda: string | null;
  pagamento_data_pagamento: Date | string | null;
  pagamento_created_at: Date | string;
  produto_id: string | null;
  produto_nome: string | null;
  pagamento_descricao: string | null;
  comprador_id: string;
  comprador_nome: string | null;
  comprador_email: string | null;
  endereco_logradouro: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_estado: string | null;
  endereco_cep: string | null;
};

type VendaEndereco = {
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
};

type VendaItem = {
  pagamentoId: string;
  valor: string | null;
  moeda: string | null;
  dataPagamento: string | null;
  createdAt: string;
  produtoId: string | null;
  produtoNome: string;
  comprador: {
    id: string;
    nome: string;
    email: string | null;
  };
  endereco: VendaEndereco | null;
};

type GestaoVendasResponse = {
  resumo: {
    totalVendasAprovadas: number;
    vendasMesAtual: number;
    mesReferencia: string;
    receitaTotalAprovada: string;
  };
  vendas: VendaItem[];
};

@Injectable()
export class VendasGestaoService {
  constructor(
    @InjectRepository(Pagamento)
    private readonly pagamentosRepository: Repository<Pagamento>,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
  ) {}

  async getDashboard(userId: string): Promise<GestaoVendasResponse> {
    await this.assertAdminUser(userId);

    const mesReferencia = this.resolveReferenceMonth();
    const vendas = await this.loadSales();
    const receitaTotalAprovada = this.sumRevenue(vendas);
    const vendasMesAtual = vendas.filter((venda) => {
      const vendaDate = venda.dataPagamento ?? venda.createdAt;
      return this.resolveMonthFromIso(vendaDate) === mesReferencia;
    }).length;

    return {
      resumo: {
        totalVendasAprovadas: vendas.length,
        vendasMesAtual,
        mesReferencia,
        receitaTotalAprovada,
      },
      vendas,
    };
  }

  private async loadSales(): Promise<VendaItem[]> {
    const rawRows = await this.pagamentosRepository
      .createQueryBuilder('pagamento')
      .leftJoin('usuarios', 'usuario', 'usuario.id = pagamento.usuario_id')
      .leftJoin(
        'produtos',
        'produto',
        `produto.id::text = COALESCE(
          pagamento.detalhes_gateway ->> 'produtoId',
          pagamento.detalhes_gateway ->> 'produto_id'
        )`,
      )
      .leftJoin(
        'endereco_usuarios',
        'endereco',
        'endereco.usuario_id = pagamento.usuario_id',
      )
      .select([
        'pagamento.id AS pagamento_id',
        'pagamento.valor AS pagamento_valor',
        'pagamento.moeda AS pagamento_moeda',
        'pagamento.data_pagamento AS pagamento_data_pagamento',
        'pagamento.created_at AS pagamento_created_at',
        `COALESCE(
          pagamento.detalhes_gateway ->> 'produtoId',
          pagamento.detalhes_gateway ->> 'produto_id'
        ) AS produto_id`,
        'produto.nome AS produto_nome',
        'pagamento.descricao AS pagamento_descricao',
        'usuario.id AS comprador_id',
        'usuario.nome AS comprador_nome',
        'usuario.email AS comprador_email',
        'endereco.logradouro AS endereco_logradouro',
        'endereco.numero AS endereco_numero',
        'endereco.complemento AS endereco_complemento',
        'endereco.bairro AS endereco_bairro',
        'endereco.cidade AS endereco_cidade',
        'endereco.estado AS endereco_estado',
        'endereco.cep AS endereco_cep',
      ])
      .where('pagamento.status = :status', { status: 'APPROVED' })
      .andWhere(
        `btrim(
          COALESCE(
            pagamento.detalhes_gateway ->> 'produtoId',
            pagamento.detalhes_gateway ->> 'produto_id',
            ''
          )
        ) <> ''`,
      )
      .orderBy(
        'COALESCE(pagamento.data_pagamento, pagamento.created_at)',
        'DESC',
      )
      .addOrderBy('pagamento.id', 'DESC')
      .getRawMany<VendaRaw>();

    return rawRows.map((row) => this.toVendaItem(row));
  }

  private toVendaItem(raw: VendaRaw): VendaItem {
    return {
      pagamentoId: raw.pagamento_id,
      valor:
        typeof raw.pagamento_valor === 'string' && raw.pagamento_valor.trim()
          ? raw.pagamento_valor.trim()
          : null,
      moeda:
        typeof raw.pagamento_moeda === 'string' && raw.pagamento_moeda.trim()
          ? raw.pagamento_moeda.trim().toUpperCase()
          : null,
      dataPagamento: this.toIsoString(raw.pagamento_data_pagamento),
      createdAt:
        this.toIsoString(raw.pagamento_created_at) ?? new Date().toISOString(),
      produtoId:
        typeof raw.produto_id === 'string' && raw.produto_id.trim()
          ? raw.produto_id.trim()
          : null,
      produtoNome: this.resolveProductName(raw),
      comprador: {
        id: raw.comprador_id,
        nome:
          typeof raw.comprador_nome === 'string' && raw.comprador_nome.trim()
            ? raw.comprador_nome.trim()
            : 'Comprador sem nome',
        email:
          typeof raw.comprador_email === 'string' && raw.comprador_email.trim()
            ? raw.comprador_email.trim()
            : null,
      },
      endereco: this.resolveAddress(raw),
    };
  }

  private resolveProductName(raw: VendaRaw): string {
    if (typeof raw.produto_nome === 'string' && raw.produto_nome.trim()) {
      return raw.produto_nome.trim();
    }

    if (
      typeof raw.pagamento_descricao === 'string' &&
      raw.pagamento_descricao.trim()
    ) {
      return raw.pagamento_descricao.replace(/^produto\s+/i, '').trim();
    }

    return 'Produto nao identificado';
  }

  private resolveAddress(raw: VendaRaw): VendaEndereco | null {
    if (
      !raw.endereco_logradouro ||
      !raw.endereco_numero ||
      !raw.endereco_bairro ||
      !raw.endereco_cidade ||
      !raw.endereco_estado ||
      !raw.endereco_cep
    ) {
      return null;
    }

    return {
      logradouro: raw.endereco_logradouro,
      numero: raw.endereco_numero,
      complemento: raw.endereco_complemento ?? null,
      bairro: raw.endereco_bairro,
      cidade: raw.endereco_cidade,
      estado: raw.endereco_estado,
      cep: raw.endereco_cep,
    };
  }

  private sumRevenue(vendas: VendaItem[]): string {
    const total = vendas.reduce((acc, venda) => {
      if (!venda.valor) {
        return acc;
      }

      const numericValue = Number(venda.valor.replace(',', '.'));
      return Number.isFinite(numericValue) ? acc + numericValue : acc;
    }, 0);

    return total.toFixed(2);
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

  private resolveReferenceMonth(): string {
    return this.resolveMonthFromIso(new Date().toISOString());
  }

  private resolveMonthFromIso(dateIso: string): string {
    const date = new Date(dateIso);

    if (Number.isNaN(date.getTime())) {
      const fallback = new Date();
      const fallbackYear = String(fallback.getUTCFullYear());
      const fallbackMonth = String(fallback.getUTCMonth() + 1).padStart(2, '0');
      return `${fallbackYear}-${fallbackMonth}`;
    }

    const dateParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);

    const year = dateParts.find((part) => part.type === 'year')?.value ?? '';
    const month = dateParts.find((part) => part.type === 'month')?.value ?? '';

    if (!year || !month) {
      const fallbackYear = String(date.getUTCFullYear());
      const fallbackMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
      return `${fallbackYear}-${fallbackMonth}`;
    }

    return `${year}-${month}`;
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
