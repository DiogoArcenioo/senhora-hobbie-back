import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnderecoUsuario } from '../usuarios/entities/endereco-usuario.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Produto } from '../produtos/entities/produto.entity';
import { Pagamento } from './entities/pagamento.entity';
import { VendaProduto } from './entities/venda-produto.entity';

export type VendaProdutoEndereco = {
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
};

export type VendaProdutoItem = {
  id: string;
  pagamentoId: string;
  produtoId: string;
  produtoNome: string;
  valor: string;
  moeda: string;
  statusEnvio: string;
  codigoRastreio: string | null;
  observacoes: string | null;
  dataPagamento: string | null;
  enviadoEm: string | null;
  entregueEm: string | null;
  createdAt: string;
  comprador: {
    id: string;
    nome: string;
    email: string | null;
  };
  endereco: VendaProdutoEndereco;
};

export type VendasDashboard = {
  resumo: {
    totalVendasAprovadas: number;
    vendasMesAtual: number;
    mesReferencia: string;
    receitaTotalAprovada: string;
    pendentesEnvio: number;
    enviadas: number;
    entregues: number;
  };
  vendas: VendaProdutoItem[];
};

type VendaComRelacoes = VendaProduto & {
  comprador: Usuario | null;
};

@Injectable()
export class VendasProdutosService {
  private readonly logger = new Logger(VendasProdutosService.name);

  constructor(
    @InjectRepository(VendaProduto)
    private readonly vendasRepository: Repository<VendaProduto>,
    @InjectRepository(Pagamento)
    private readonly pagamentosRepository: Repository<Pagamento>,
    @InjectRepository(Produto)
    private readonly produtosRepository: Repository<Produto>,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    @InjectRepository(EnderecoUsuario)
    private readonly enderecosRepository: Repository<EnderecoUsuario>,
  ) {}

  async ensureVendaRegistered(
    pagamento: Pagamento,
    produtoId: string | null,
  ): Promise<VendaProduto | null> {
    if (!pagamento || pagamento.status !== 'APPROVED') {
      return null;
    }

    const normalizedProdutoId =
      typeof produtoId === 'string' && produtoId.trim()
        ? produtoId.trim()
        : null;

    if (!normalizedProdutoId) {
      return null;
    }

    const vendaExistente = await this.vendasRepository.findOne({
      where: { pagamento_id: pagamento.id },
    });

    if (vendaExistente) {
      let houveMudanca = false;

      if (pagamento.data_pagamento && !vendaExistente.data_pagamento) {
        vendaExistente.data_pagamento = pagamento.data_pagamento;
        houveMudanca = true;
      }

      if (houveMudanca) {
        return this.vendasRepository.save(vendaExistente);
      }

      return vendaExistente;
    }

    const produto = await this.produtosRepository.findOne({
      where: { id: normalizedProdutoId },
    });

    if (!produto) {
      this.logger.warn(
        `Produto ${normalizedProdutoId} nao encontrado ao registrar venda do pagamento ${pagamento.id}`,
      );
      return null;
    }

    const endereco = await this.enderecosRepository.findOne({
      where: { usuario_id: pagamento.usuario_id },
    });

    if (!endereco) {
      this.logger.warn(
        `Endereco do usuario ${pagamento.usuario_id} nao encontrado ao registrar venda do pagamento ${pagamento.id}`,
      );
      return null;
    }

    const venda = this.vendasRepository.create({
      pagamento_id: pagamento.id,
      usuario_id: pagamento.usuario_id,
      produto_id: produto.id,
      produto_nome: produto.nome,
      valor: this.normalizeValor(pagamento.valor, produto.preco),
      moeda: (pagamento.moeda || produto.moeda || 'BRL').toUpperCase(),
      status_envio: 'PENDENTE_ENVIO',
      endereco_logradouro: endereco.logradouro,
      endereco_numero: endereco.numero,
      endereco_complemento: endereco.complemento,
      endereco_bairro: endereco.bairro,
      endereco_cidade: endereco.cidade,
      endereco_estado: endereco.estado,
      endereco_cep: endereco.cep,
      codigo_rastreio: null,
      observacoes: null,
      data_pagamento: pagamento.data_pagamento ?? null,
      enviado_em: null,
      entregue_em: null,
    });

    return this.vendasRepository.save(venda);
  }

  async listarParaAdmin(
    adminUserId: string,
    filtro: { statusEnvio?: string | null } = {},
  ): Promise<VendasDashboard> {
    await this.assertAdminUser(adminUserId);

    const vendas = await this.carregarVendas(filtro);
    const receitaTotalAprovada = this.sumRevenue(vendas);
    const mesReferencia = this.resolveReferenceMonth();
    const vendasMesAtual = vendas.filter((venda) => {
      const vendaDate = venda.dataPagamento ?? venda.createdAt;
      return this.resolveMonthFromIso(vendaDate) === mesReferencia;
    }).length;

    const pendentesEnvio = vendas.filter(
      (venda) => venda.statusEnvio === 'PENDENTE_ENVIO',
    ).length;
    const enviadas = vendas.filter(
      (venda) => venda.statusEnvio === 'ENVIADO',
    ).length;
    const entregues = vendas.filter(
      (venda) => venda.statusEnvio === 'ENTREGUE',
    ).length;

    return {
      resumo: {
        totalVendasAprovadas: vendas.length,
        vendasMesAtual,
        mesReferencia,
        receitaTotalAprovada,
        pendentesEnvio,
        enviadas,
        entregues,
      },
      vendas,
    };
  }

  async listarMinhasCompras(userId: string): Promise<VendaProdutoItem[]> {
    const normalizedUserId = userId.trim();

    if (!normalizedUserId) {
      throw new ForbiddenException('Usuario nao autenticado');
    }

    const vendas = await this.vendasRepository.find({
      where: { usuario_id: normalizedUserId },
      order: { created_at: 'DESC', id: 'DESC' },
    });

    const comprador = await this.usuariosRepository.findOne({
      where: { id: normalizedUserId },
    });

    return vendas.map((venda) =>
      this.toVendaItem({
        ...venda,
        comprador,
      }),
    );
  }

  async marcarEnviado(
    adminUserId: string,
    vendaId: string,
    dto: { codigoRastreio?: string | null; observacoes?: string | null },
  ): Promise<VendaProdutoItem> {
    await this.assertAdminUser(adminUserId);

    const venda = await this.vendasRepository.findOne({
      where: { id: vendaId },
    });

    if (!venda) {
      throw new NotFoundException('Venda nao encontrada');
    }

    if (venda.status_envio === 'ENVIADO' || venda.status_envio === 'ENTREGUE') {
      throw new BadRequestException('Venda ja foi enviada');
    }

    const codigoRastreio = this.optionalTrim(dto.codigoRastreio);
    const observacoes = this.optionalTrim(dto.observacoes);

    venda.status_envio = 'ENVIADO';
    venda.codigo_rastreio = codigoRastreio;
    venda.observacoes = observacoes;
    venda.enviado_em = new Date();

    const vendaSalva = await this.vendasRepository.save(venda);
    const comprador = await this.usuariosRepository.findOne({
      where: { id: vendaSalva.usuario_id },
    });

    return this.toVendaItem({
      ...vendaSalva,
      comprador,
    });
  }

  async marcarEntregue(
    adminUserId: string,
    vendaId: string,
  ): Promise<VendaProdutoItem> {
    await this.assertAdminUser(adminUserId);

    const venda = await this.vendasRepository.findOne({
      where: { id: vendaId },
    });

    if (!venda) {
      throw new NotFoundException('Venda nao encontrada');
    }

    if (venda.status_envio !== 'ENVIADO') {
      throw new BadRequestException(
        'Apenas vendas enviadas podem ser marcadas como entregues',
      );
    }

    venda.status_envio = 'ENTREGUE';
    venda.entregue_em = new Date();

    const vendaSalva = await this.vendasRepository.save(venda);
    const comprador = await this.usuariosRepository.findOne({
      where: { id: vendaSalva.usuario_id },
    });

    return this.toVendaItem({
      ...vendaSalva,
      comprador,
    });
  }

  private async carregarVendas(filtro: {
    statusEnvio?: string | null;
  }): Promise<VendaProdutoItem[]> {
    const query = this.vendasRepository
      .createQueryBuilder('venda')
      .leftJoinAndMapOne(
        'venda.comprador',
        Usuario,
        'comprador',
        'comprador.id = venda.usuario_id',
      )
      .orderBy(
        'COALESCE(venda.data_pagamento, venda.created_at)',
        'DESC',
      )
      .addOrderBy('venda.id', 'DESC');

    const statusEnvio = this.normalizeStatus(filtro.statusEnvio);

    if (statusEnvio) {
      query.where('venda.status_envio = :statusEnvio', { statusEnvio });
    }

    const vendas = (await query.getMany()) as VendaComRelacoes[];
    return vendas.map((venda) => this.toVendaItem(venda));
  }

  private toVendaItem(venda: VendaComRelacoes): VendaProdutoItem {
    const comprador = venda.comprador ?? null;

    return {
      id: venda.id,
      pagamentoId: venda.pagamento_id,
      produtoId: venda.produto_id,
      produtoNome: venda.produto_nome,
      valor: this.formatAmount(venda.valor),
      moeda: (venda.moeda || 'BRL').toUpperCase(),
      statusEnvio: venda.status_envio,
      codigoRastreio: venda.codigo_rastreio,
      observacoes: venda.observacoes,
      dataPagamento: this.toIsoString(venda.data_pagamento),
      enviadoEm: this.toIsoString(venda.enviado_em),
      entregueEm: this.toIsoString(venda.entregue_em),
      createdAt:
        this.toIsoString(venda.created_at) ?? new Date().toISOString(),
      comprador: {
        id: comprador?.id ?? venda.usuario_id,
        nome: comprador?.nome?.trim() || 'Comprador sem nome',
        email: comprador?.email?.trim() || null,
      },
      endereco: {
        logradouro: venda.endereco_logradouro,
        numero: venda.endereco_numero,
        complemento: venda.endereco_complemento ?? null,
        bairro: venda.endereco_bairro,
        cidade: venda.endereco_cidade,
        estado: venda.endereco_estado,
        cep: venda.endereco_cep,
      },
    };
  }

  private normalizeStatus(statusEnvio?: string | null): string | null {
    if (!statusEnvio) {
      return null;
    }

    const normalized = statusEnvio.trim().toUpperCase();

    if (
      normalized !== 'PENDENTE_ENVIO' &&
      normalized !== 'ENVIADO' &&
      normalized !== 'ENTREGUE'
    ) {
      return null;
    }

    return normalized;
  }

  private normalizeValor(valor: string | null, fallback: string): string {
    const candidates = [valor, fallback];

    for (const candidate of candidates) {
      const normalized = this.formatAmount(candidate);

      if (normalized !== '0.00') {
        return normalized;
      }
    }

    return this.formatAmount(fallback);
  }

  private formatAmount(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0.00';
    }

    const numeric = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(numeric)) {
      return '0.00';
    }

    return numeric.toFixed(2);
  }

  private optionalTrim(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private sumRevenue(vendas: VendaProdutoItem[]): string {
    const total = vendas.reduce((acc, venda) => {
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
