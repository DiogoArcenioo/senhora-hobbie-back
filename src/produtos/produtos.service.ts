import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Repository } from 'typeorm';
import { Imagem } from '../imagens/entities/imagem.entity';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { ProdutoImagem } from './entities/produto-imagem.entity';
import { Produto } from './entities/produto.entity';

const PRODUTO_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const PRODUTO_MAX_FILE_SIZE_MB = 25;
const PRODUTO_MAX_FOTOS_GALERIA = 30;

type ProdutoInput = {
  nome?: string;
  descricao?: string;
  preco?: string;
  moeda?: string;
  ativo?: string;
};

type ProdutoFotoPublica = {
  id: string;
  url: string;
  legenda: string | null;
  ordem: number;
};

type ProdutoPublicoResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: string;
  moeda: string;
  capaUrl: string | null;
};

type ProdutoDetalhe = ProdutoPublicoResumo & {
  slug: string;
  ativo: boolean;
  fotos: ProdutoFotoPublica[];
};

@Injectable()
export class ProdutosService {
  private supabaseClient: SupabaseClient | null = null;
  private readonly storageBucket: string;

  constructor(
    @InjectRepository(Produto)
    private readonly produtosRepository: Repository<Produto>,
    @InjectRepository(ProdutoImagem)
    private readonly produtoImagensRepository: Repository<ProdutoImagem>,
    @InjectRepository(Imagem)
    private readonly imagensRepository: Repository<Imagem>,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly configService: ConfigService,
  ) {
    this.storageBucket =
      this.configService.get<string>(
        'SUPABASE_STORAGE_BUCKET',
        'user-images',
      ) ?? 'user-images';
  }

  async listarProdutosPublicos(): Promise<ProdutoPublicoResumo[]> {
    const produtos = await this.produtosRepository.find({
      where: { ativo: true },
      order: {
        created_at: 'DESC',
        id: 'DESC',
      },
    });

    return produtos.map((produto) => this.toProdutoResumo(produto));
  }

  async obterProdutoPublico(id: string): Promise<ProdutoDetalhe> {
    const produto = await this.findProdutoByIdOrSlug(id, {
      onlyActive: true,
    });

    return this.toProdutoDetalhe(produto);
  }

  async listarProdutosAdmin(userId: string): Promise<ProdutoDetalhe[]> {
    await this.validarPermissaoAdmin(userId);

    const produtos = await this.produtosRepository.find({
      order: {
        created_at: 'DESC',
        id: 'DESC',
      },
    });

    return Promise.all(
      produtos.map((produto) => this.toProdutoDetalhe(produto)),
    );
  }

  async obterProdutoAdmin(userId: string, id: string): Promise<ProdutoDetalhe> {
    await this.validarPermissaoAdmin(userId);
    const produto = await this.findProdutoByIdOrSlug(id);
    return this.toProdutoDetalhe(produto);
  }

  async criarProdutoComImagens(
    userId: string,
    body: ProdutoInput,
    arquivos: {
      capa?: Express.Multer.File[];
      fotos?: Express.Multer.File[];
    },
  ): Promise<ProdutoDetalhe> {
    await this.validarPermissaoAdmin(userId);

    const nome = this.requireText(body.nome, 'Nome do produto obrigatorio');
    const descricao = this.optionalText(body.descricao);
    const preco = this.normalizePrice(body.preco);
    const moeda = this.normalizeCurrency(body.moeda);
    const ativo = this.normalizeBoolean(body.ativo, true);

    const capaArquivo = arquivos.capa?.[0];
    if (!capaArquivo) {
      throw new BadRequestException('Foto de capa obrigatoria');
    }

    const fotosArquivos = arquivos.fotos ?? [];
    this.validarArquivos(capaArquivo, fotosArquivos);

    const slug = await this.generateUniqueSlug(nome);

    const capaImagem = await this.uploadArquivoParaImagem({
      arquivo: capaArquivo,
      usuarioId: userId,
      pasta: `produtos/capas/${slug}`,
      descricao: `Capa do produto ${nome}`,
    });

    const produto = await this.produtosRepository.save(
      this.produtosRepository.create({
        criado_por_usuario_id: userId,
        nome,
        slug,
        descricao,
        preco,
        moeda,
        capa_imagem: capaImagem,
        ativo,
      }),
    );

    let ordem = 0;
    for (const arquivo of fotosArquivos) {
      const imagem = await this.uploadArquivoParaImagem({
        arquivo,
        usuarioId: userId,
        pasta: `produtos/galeria/${slug}`,
        descricao: `Foto da galeria do produto ${nome}`,
      });

      const item = this.produtoImagensRepository.create({
        produto_id: produto.id,
        imagem_id: imagem.id,
        imagem,
        ordem,
        legenda: null,
        destaque: false,
      });

      await this.produtoImagensRepository.save(item);
      ordem += 1;
    }

    return this.toProdutoDetalhe(produto);
  }

  async atualizarProdutoComImagens(
    userId: string,
    id: string,
    body: ProdutoInput,
    arquivos: {
      capa?: Express.Multer.File[];
      fotos?: Express.Multer.File[];
    },
  ): Promise<ProdutoDetalhe> {
    await this.validarPermissaoAdmin(userId);

    const produto = await this.findProdutoByIdOrSlug(id);
    const capaAnterior = produto.capa_imagem;
    const capaArquivo = arquivos.capa?.[0];
    const fotosArquivos = arquivos.fotos ?? [];

    if (capaArquivo) {
      this.validarArquivo(capaArquivo);
    }

    if (fotosArquivos.length > PRODUTO_MAX_FOTOS_GALERIA) {
      throw new BadRequestException(
        `Limite maximo de ${PRODUTO_MAX_FOTOS_GALERIA} fotos na galeria por envio.`,
      );
    }

    for (const arquivo of fotosArquivos) {
      this.validarArquivo(arquivo);
    }

    if (body.nome !== undefined) {
      produto.nome = this.requireText(body.nome, 'Nome do produto obrigatorio');
    }

    if (body.descricao !== undefined) {
      produto.descricao = this.optionalText(body.descricao);
    }

    if (body.preco !== undefined) {
      produto.preco = this.normalizePrice(body.preco);
    }

    if (body.moeda !== undefined) {
      produto.moeda = this.normalizeCurrency(body.moeda);
    }

    if (body.ativo !== undefined) {
      produto.ativo = this.normalizeBoolean(body.ativo, produto.ativo);
    }

    if (capaArquivo) {
      const novaCapa = await this.uploadArquivoParaImagem({
        arquivo: capaArquivo,
        usuarioId: userId,
        pasta: `produtos/capas/${produto.slug}`,
        descricao: `Capa do produto ${produto.nome}`,
      });

      produto.capa_imagem = novaCapa;
    }

    const produtoAtualizado = await this.produtosRepository.save(produto);

    if (fotosArquivos.length > 0) {
      const quantidadeAtual = await this.produtoImagensRepository.count({
        where: { produto_id: produto.id },
      });

      let ordem = quantidadeAtual;
      for (const arquivo of fotosArquivos) {
        const imagem = await this.uploadArquivoParaImagem({
          arquivo,
          usuarioId: userId,
          pasta: `produtos/galeria/${produto.slug}`,
          descricao: `Foto da galeria do produto ${produto.nome}`,
        });

        const item = this.produtoImagensRepository.create({
          produto_id: produto.id,
          imagem_id: imagem.id,
          imagem,
          ordem,
          legenda: null,
          destaque: false,
        });

        await this.produtoImagensRepository.save(item);
        ordem += 1;
      }
    }

    if (
      capaAnterior &&
      produtoAtualizado.capa_imagem &&
      String(capaAnterior.id) !== String(produtoAtualizado.capa_imagem.id)
    ) {
      const stillUsedAsCover = await this.produtosRepository.exist({
        where: {
          capa_imagem: { id: String(capaAnterior.id) },
        },
      });
      const stillUsedInGallery = await this.produtoImagensRepository.exist({
        where: { imagem_id: String(capaAnterior.id) },
      });

      if (!stillUsedAsCover && !stillUsedInGallery) {
        await this.inativarImagem(capaAnterior);
      }
    }

    return this.toProdutoDetalhe(produtoAtualizado);
  }

  async removerProduto(
    userId: string,
    id: string,
  ): Promise<{ message: string }> {
    await this.validarPermissaoAdmin(userId);

    const produto = await this.findProdutoByIdOrSlug(id);
    produto.ativo = false;
    await this.produtosRepository.save(produto);

    return {
      message: 'Produto inativado com sucesso.',
    };
  }

  async removerFotoProduto(
    userId: string,
    produtoId: string,
    fotoId: string,
  ): Promise<{ message: string }> {
    await this.validarPermissaoAdmin(userId);
    await this.findProdutoByIdOrSlug(produtoId);

    const registro = await this.produtoImagensRepository.findOne({
      where: {
        id: fotoId.trim(),
        produto_id: produtoId.trim(),
      },
    });

    if (!registro) {
      throw new NotFoundException('Foto do produto nao encontrada.');
    }

    const imagem = registro.imagem;
    await this.produtoImagensRepository.remove(registro);

    if (imagem) {
      const stillUsedAsCover = await this.produtosRepository.exist({
        where: {
          capa_imagem: { id: String(imagem.id) },
        },
      });
      const stillUsedInGallery = await this.produtoImagensRepository.exist({
        where: { imagem_id: String(imagem.id) },
      });

      if (!stillUsedAsCover && !stillUsedInGallery) {
        await this.inativarImagem(imagem);
      }
    }

    await this.reordenarFotosProduto(produtoId.trim());

    return {
      message: 'Foto removida com sucesso.',
    };
  }

  private async reordenarFotosProduto(produtoId: string): Promise<void> {
    const registros = await this.produtoImagensRepository.find({
      where: { produto_id: produtoId },
      order: {
        ordem: 'ASC',
        id: 'ASC',
      },
    });

    for (const [indice, registro] of registros.entries()) {
      if (registro.ordem !== indice) {
        registro.ordem = indice;
        await this.produtoImagensRepository.save(registro);
      }
    }
  }

  private async toProdutoDetalhe(produto: Produto): Promise<ProdutoDetalhe> {
    const fotos = await this.produtoImagensRepository.find({
      where: { produto_id: produto.id },
      order: {
        ordem: 'ASC',
        id: 'ASC',
      },
    });

    const fotosPublicas = fotos
      .filter((item) => item.imagem?.ativo)
      .map((item) => {
        const url = this.buildPublicUrl(item.imagem);

        if (!url) {
          return null;
        }

        return {
          id: item.id,
          url,
          legenda: item.legenda,
          ordem: item.ordem,
        };
      })
      .filter((item): item is ProdutoFotoPublica => item !== null);

    return {
      ...this.toProdutoResumo(produto),
      slug: produto.slug,
      ativo: produto.ativo,
      fotos: fotosPublicas,
    };
  }

  private toProdutoResumo(produto: Produto): ProdutoPublicoResumo {
    return {
      id: produto.id,
      nome: produto.nome,
      descricao: produto.descricao,
      preco: produto.preco,
      moeda: produto.moeda,
      capaUrl: this.buildPublicUrl(produto.capa_imagem),
    };
  }

  private buildPublicUrl(imagem: Imagem | null): string | null {
    if (!imagem || !imagem.ativo) {
      return null;
    }

    const supabaseClient = this.getSupabaseClient();
    const { data } = supabaseClient.storage
      .from(imagem.bucket)
      .getPublicUrl(imagem.caminho);

    return data.publicUrl;
  }

  private async findProdutoByIdOrSlug(
    rawValue: string,
    options?: { onlyActive?: boolean },
  ): Promise<Produto> {
    const value = rawValue.trim();

    if (!value) {
      throw new NotFoundException('Produto nao encontrado.');
    }

    const query = this.produtosRepository.createQueryBuilder('produto');
    query.leftJoinAndSelect('produto.capa_imagem', 'capa_imagem');
    query.where('(produto.id = :id OR produto.slug = :slug)', {
      id: value,
      slug: value.toLowerCase(),
    });

    if (options?.onlyActive) {
      query.andWhere('produto.ativo = :ativo', { ativo: true });
    }

    const produto = await query.getOne();

    if (!produto) {
      throw new NotFoundException('Produto nao encontrado.');
    }

    return produto;
  }

  private async validarPermissaoAdmin(userId: string): Promise<void> {
    const usuario = await this.usuariosRepository.findOne({
      where: { id: userId },
    });

    const isAdmin =
      !!usuario &&
      usuario.ativo &&
      typeof usuario.tipo === 'string' &&
      usuario.tipo.trim().toUpperCase() === 'ADM';

    if (!isAdmin) {
      throw new ForbiddenException(
        'Somente administradores podem gerenciar produtos.',
      );
    }
  }

  private requireText(value: string | undefined, message: string): string {
    const normalized = this.optionalText(value);

    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private optionalText(value: string | undefined): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizePrice(value: string | undefined): string {
    if (!value || !value.trim()) {
      throw new BadRequestException('Preco do produto obrigatorio.');
    }

    const parsedValue = Number(value.replace(',', '.'));

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      throw new BadRequestException('Preco do produto invalido.');
    }

    return parsedValue.toFixed(2);
  }

  private normalizeCurrency(value: string | undefined): string {
    const normalized = (value || 'BRL').trim().toUpperCase();

    if (!normalized) {
      return 'BRL';
    }

    return normalized.slice(0, 10);
  }

  private normalizeBoolean(
    value: string | undefined,
    fallback: boolean,
  ): boolean {
    if (typeof value === 'undefined') {
      return fallback;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === 'true' || normalized === '1') {
      return true;
    }

    if (normalized === 'false' || normalized === '0') {
      return false;
    }

    throw new BadRequestException('Campo ativo invalido.');
  }

  private validarArquivos(
    capaArquivo: Express.Multer.File,
    fotosArquivos: Express.Multer.File[],
  ): void {
    this.validarArquivo(capaArquivo);

    if (fotosArquivos.length > PRODUTO_MAX_FOTOS_GALERIA) {
      throw new BadRequestException(
        `Limite maximo de ${PRODUTO_MAX_FOTOS_GALERIA} fotos na galeria por envio.`,
      );
    }

    for (const arquivo of fotosArquivos) {
      this.validarArquivo(arquivo);
    }
  }

  private validarArquivo(arquivo: Express.Multer.File | undefined): void {
    if (!arquivo) {
      throw new BadRequestException('Arquivo de imagem nao informado.');
    }

    if (!arquivo.mimetype || !arquivo.mimetype.startsWith('image/')) {
      throw new BadRequestException(
        'Apenas arquivos de imagem sao permitidos.',
      );
    }

    if (arquivo.size > PRODUTO_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `Imagem excede o limite de ${PRODUTO_MAX_FILE_SIZE_MB}MB`,
      );
    }
  }

  private async uploadArquivoParaImagem(params: {
    arquivo: Express.Multer.File;
    usuarioId: string;
    pasta: string;
    descricao: string;
  }): Promise<Imagem> {
    const nomeArquivoSeguro = this.sanitizeFilename(
      params.arquivo.originalname || 'imagem',
    );
    const caminho = `${params.pasta}/${Date.now()}-${nomeArquivoSeguro}`;
    const supabaseClient = this.getSupabaseClient();

    const { error: uploadError } = await supabaseClient.storage
      .from(this.storageBucket)
      .upload(caminho, params.arquivo.buffer, {
        contentType: params.arquivo.mimetype,
        upsert: false,
      });

    if (uploadError) {
      throw new InternalServerErrorException(
        `Falha no upload para Supabase: ${uploadError.message}`,
      );
    }

    const imagem = this.imagensRepository.create({
      usuario_id: params.usuarioId,
      bucket: this.storageBucket,
      caminho,
      nome_original: params.arquivo.originalname || null,
      tipo_mime: params.arquivo.mimetype || null,
      tamanho_bytes: params.arquivo.size,
      descricao: params.descricao,
      publico: true,
      ativo: true,
    });

    return this.imagensRepository.save(imagem);
  }

  private async inativarImagem(imagem: Imagem): Promise<void> {
    imagem.ativo = false;
    await this.imagensRepository.save(imagem);

    const supabaseClient = this.getSupabaseClient();
    await supabaseClient.storage.from(imagem.bucket).remove([imagem.caminho]);
  }

  private sanitizeFilename(filename: string): string {
    const trimmed = filename.trim().toLowerCase();
    const normalized = trimmed
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '');

    if (!normalized) {
      return 'imagem.jpg';
    }

    return normalized;
  }

  private async generateUniqueSlug(nome: string): Promise<string> {
    const base =
      nome
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'produto';

    let slug = base;
    let suffix = 0;

    while (true) {
      const existente = await this.produtosRepository.findOne({
        where: { slug },
        select: { id: true, slug: true },
      });

      if (!existente) {
        return slug;
      }

      suffix += 1;
      slug = `${base}-${suffix}`;
    }
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);

    if (!value || value.trim().length === 0) {
      throw new Error(`Variavel de ambiente obrigatoria ausente: ${key}`);
    }

    return value.trim();
  }

  private getSupabaseClient(): SupabaseClient {
    if (this.supabaseClient) {
      return this.supabaseClient;
    }

    const supabaseUrl = this.getRequiredEnv('SUPABASE_URL');
    const serviceRoleKey = this.getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

    this.supabaseClient = createClient(supabaseUrl, serviceRoleKey);
    return this.supabaseClient;
  }
}
