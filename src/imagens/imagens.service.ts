import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { Imagem } from './entities/imagem.entity';
import { SiteImagem } from './entities/site-imagem.entity';
import { SiteSliderImagem } from './entities/site-slider-imagem.entity';

const HOME_DESTAQUE_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const HOME_DESTAQUE_MAX_FILE_SIZE_MB = 10;
const HOME_SLIDER_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const HOME_SLIDER_MAX_FILE_SIZE_MB = 25;
const HOME_SLIDER_MAX_SLIDES = 4;

type ImagemPublica = {
  imagemId: string;
  bucket: string;
  caminho: string;
  urlPublica: string;
  updatedAt: Date;
};

type HomeSliderPublico = {
  id: string;
  imagemId: string;
  bucket: string;
  caminho: string;
  urlPublica: string;
  imageUrl: string;
  alt: string | null;
  ordem: number;
  updatedAt: Date;
};

type HomeSliderBody = Record<string, string | string[] | undefined>;

type HomeSliderInputItem = {
  id: string | null;
  clientId: string;
  alt: string | null;
  ordem: number;
  indiceOriginal: number;
};

type HomeSliderPersistItem = {
  ordem: number;
  alt: string | null;
  imagem: Imagem;
};

type HomeSliderRawItem = {
  id?: string | number | null;
  clientId?: string | null;
  alt?: string | null;
  ordem?: number | string | null;
  imageUrl?: string | null;
};

@Injectable()
export class ImagensService {
  private supabaseClient: SupabaseClient | null = null;
  private readonly storageBucket: string;

  constructor(
    @InjectRepository(Imagem)
    private readonly imagensRepository: Repository<Imagem>,
    @InjectRepository(SiteImagem)
    private readonly siteImagensRepository: Repository<SiteImagem>,
    @InjectRepository(SiteSliderImagem)
    private readonly siteSliderImagensRepository: Repository<SiteSliderImagem>,
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

  async obterImagemHomeDestaque(): Promise<ImagemPublica | null> {
    const registro = await this.siteImagensRepository.findOne({
      where: { chave: 'home_destaque' },
    });

    if (!registro?.imagem || !registro.imagem.ativo) {
      return null;
    }

    return this.toImagemPublica(registro.imagem);
  }

  async uploadImagemHomeDestaque(
    usuarioId: string,
    arquivo: Express.Multer.File,
  ): Promise<ImagemPublica> {
    await this.validarPermissaoAdmin(usuarioId);
    this.validarArquivo(
      arquivo,
      HOME_DESTAQUE_MAX_FILE_SIZE_BYTES,
      HOME_DESTAQUE_MAX_FILE_SIZE_MB,
    );

    const registroAnterior = await this.siteImagensRepository.findOne({
      where: { chave: 'home_destaque' },
    });

    if (registroAnterior?.imagem) {
      await this.inativarImagemAnterior(registroAnterior.imagem);
    }

    const imagemSalva = await this.uploadArquivoParaImagem({
      arquivo,
      usuarioId,
      pasta: 'site/home-destaque',
      descricao: 'Imagem de destaque da home',
    });

    const configuracao = registroAnterior
      ? this.siteImagensRepository.merge(registroAnterior, {
          imagem: imagemSalva,
        })
      : this.siteImagensRepository.create({
          chave: 'home_destaque',
          imagem: imagemSalva,
        });

    await this.siteImagensRepository.save(configuracao);

    return this.toImagemPublica(imagemSalva);
  }

  async obterSlidesHome(): Promise<HomeSliderPublico[]> {
    const registros = await this.siteSliderImagensRepository.find({
      where: {},
      order: {
        ordem: 'ASC',
        id: 'ASC',
      },
    });

    return registros
      .filter((registro) => Boolean(registro.imagem?.ativo))
      .map((registro) => this.toHomeSliderPublico(registro));
  }

  async atualizarSlidesHome(
    usuarioId: string,
    body: HomeSliderBody,
    arquivos: Express.Multer.File[],
  ): Promise<HomeSliderPublico[]> {
    await this.validarPermissaoAdmin(usuarioId);

    const itens = this.parseHomeSliderItems(body);
    this.validarItensHomeSlider(itens);
    this.validarArquivosHomeSlider(arquivos);

    const referenciasArquivos = this.readStringList(body.fotos_referencia);
    const arquivosPorClientId = this.mapearArquivosPorClientId(
      itens,
      arquivos,
      referenciasArquivos,
    );

    const registrosAtuais = await this.siteSliderImagensRepository.find({
      where: {},
      order: {
        ordem: 'ASC',
        id: 'ASC',
      },
    });

    const registroAtualPorId = new Map<string, SiteSliderImagem>();
    for (const registro of registrosAtuais) {
      registroAtualPorId.set(String(registro.id), registro);
    }

    const itensPersistencia: HomeSliderPersistItem[] = [];
    const idsImagensFinais = new Set<string>();

    for (const item of itens) {
      const arquivo = arquivosPorClientId.get(item.clientId);
      let imagemSelecionada: Imagem | null = null;

      if (arquivo) {
        imagemSelecionada = await this.uploadArquivoParaImagem({
          arquivo,
          usuarioId,
          pasta: 'site/home-slider',
          descricao: `Slide principal da home (ordem ${item.ordem + 1})`,
        });
      } else if (item.id) {
        const registroAnterior = registroAtualPorId.get(item.id);

        if (!registroAnterior?.imagem?.ativo) {
          throw new BadRequestException(
            `Slide ${item.ordem + 1} sem imagem valida. Envie o arquivo novamente.`,
          );
        }

        imagemSelecionada = registroAnterior.imagem;
      }

      if (!imagemSelecionada) {
        throw new BadRequestException(
          `Slide ${item.ordem + 1} sem imagem. Envie um arquivo para este item.`,
        );
      }

      itensPersistencia.push({
        ordem: item.ordem,
        alt: this.normalizeAlt(item.alt),
        imagem: imagemSelecionada,
      });
      idsImagensFinais.add(String(imagemSelecionada.id));
    }

    if (itensPersistencia.length === 0) {
      throw new BadRequestException(
        'Informe ao menos uma imagem para o slider.',
      );
    }

    const imagensParaInativar: Imagem[] = [];
    const idsImagensParaInativar = new Set<string>();

    for (const registro of registrosAtuais) {
      const imagem = registro.imagem;

      if (!imagem) {
        continue;
      }

      const imagemId = String(imagem.id);

      if (
        !idsImagensFinais.has(imagemId) &&
        !idsImagensParaInativar.has(imagemId)
      ) {
        idsImagensParaInativar.add(imagemId);
        imagensParaInativar.push(imagem);
      }
    }

    if (registrosAtuais.length > 0) {
      await this.siteSliderImagensRepository
        .createQueryBuilder()
        .delete()
        .from(SiteSliderImagem)
        .execute();
    }

    const novosRegistros = itensPersistencia.map((item) =>
      this.siteSliderImagensRepository.create({
        ordem: item.ordem,
        texto_alternativo: item.alt,
        imagem: item.imagem,
      }),
    );

    await this.siteSliderImagensRepository.save(novosRegistros);

    for (const imagem of imagensParaInativar) {
      await this.inativarImagemAnterior(imagem);
    }

    return this.obterSlidesHome();
  }

  private parseHomeSliderItems(body: HomeSliderBody): HomeSliderInputItem[] {
    const slidesRaw = this.readFirstString(body.slides);

    if (!slidesRaw) {
      throw new BadRequestException('Campo "slides" nao informado.');
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(slidesRaw);
    } catch {
      throw new BadRequestException('Campo "slides" em formato JSON invalido.');
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException('Campo "slides" deve ser uma lista.');
    }

    return parsed
      .map((item, index) => {
        if (!this.isRecord(item)) {
          return null;
        }

        const slide = item as HomeSliderRawItem;
        const clientId =
          typeof slide.clientId === 'string' ? slide.clientId.trim() : '';

        if (!clientId) {
          throw new BadRequestException(
            `Slide na posicao ${index + 1} sem "clientId".`,
          );
        }

        const id =
          typeof slide.id === 'string' || typeof slide.id === 'number'
            ? String(slide.id).trim()
            : '';

        const ordemLida =
          typeof slide.ordem === 'number'
            ? slide.ordem
            : typeof slide.ordem === 'string' && slide.ordem.trim().length > 0
              ? Number(slide.ordem)
              : Number.NaN;

        return {
          id: id || null,
          clientId,
          alt: typeof slide.alt === 'string' ? slide.alt : null,
          ordem: Number.isFinite(ordemLida)
            ? Math.max(0, Math.floor(ordemLida))
            : index,
          indiceOriginal: index,
        };
      })
      .filter((item): item is HomeSliderInputItem => item !== null)
      .sort((a, b) => {
        if (a.ordem === b.ordem) {
          return a.indiceOriginal - b.indiceOriginal;
        }

        return a.ordem - b.ordem;
      })
      .map((item, index) => ({
        ...item,
        ordem: index,
      }));
  }

  private validarItensHomeSlider(itens: HomeSliderInputItem[]): void {
    if (itens.length === 0) {
      throw new BadRequestException(
        'Informe ao menos uma imagem para o slider.',
      );
    }

    if (itens.length > HOME_SLIDER_MAX_SLIDES) {
      throw new BadRequestException(
        `Limite maximo de ${HOME_SLIDER_MAX_SLIDES} imagens no slider.`,
      );
    }

    const clientIds = new Set<string>();

    for (const item of itens) {
      if (clientIds.has(item.clientId)) {
        throw new BadRequestException(
          `clientId duplicado no payload do slider: ${item.clientId}`,
        );
      }

      clientIds.add(item.clientId);
    }
  }

  private validarArquivosHomeSlider(arquivos: Express.Multer.File[]): void {
    if (arquivos.length > HOME_SLIDER_MAX_SLIDES) {
      throw new BadRequestException(
        `Limite maximo de ${HOME_SLIDER_MAX_SLIDES} arquivos por envio.`,
      );
    }

    for (const arquivo of arquivos) {
      this.validarArquivo(
        arquivo,
        HOME_SLIDER_MAX_FILE_SIZE_BYTES,
        HOME_SLIDER_MAX_FILE_SIZE_MB,
      );
    }
  }

  private mapearArquivosPorClientId(
    itens: HomeSliderInputItem[],
    arquivos: Express.Multer.File[],
    referencias: string[],
  ): Map<string, Express.Multer.File> {
    if (arquivos.length === 0) {
      return new Map<string, Express.Multer.File>();
    }

    const referenciasNormalizadas = referencias
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const mapa = new Map<string, Express.Multer.File>();

    for (const [index, arquivo] of arquivos.entries()) {
      const referencia =
        referenciasNormalizadas[index] ?? itens[index]?.clientId ?? '';

      if (!referencia) {
        throw new BadRequestException(
          'Referencia de arquivo do slider ausente. Campo esperado: fotos_referencia.',
        );
      }

      if (mapa.has(referencia)) {
        throw new BadRequestException(
          `Referencia duplicada em fotos_referencia: ${referencia}`,
        );
      }

      mapa.set(referencia, arquivo);
    }

    return mapa;
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

  private normalizeAlt(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    return normalized.slice(0, 180);
  }

  private readStringList(value: string | string[] | undefined): string[] {
    if (typeof value === 'undefined') {
      return [];
    }

    if (typeof value === 'string') {
      return [value];
    }

    return value.filter((item) => typeof item === 'string');
  }

  private readFirstString(value: string | string[] | undefined): string | null {
    const values = this.readStringList(value);

    if (values.length === 0) {
      return null;
    }

    return values[0] ?? null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private async validarPermissaoAdmin(usuarioId: string): Promise<void> {
    const usuario = await this.usuariosRepository.findOne({
      where: { id: usuarioId },
    });

    if (!usuario || !usuario.ativo || usuario.tipo !== 'ADM') {
      throw new ForbiddenException(
        'Somente administradores podem editar esta imagem',
      );
    }
  }

  private validarArquivo(
    arquivo: Express.Multer.File | undefined,
    maxSizeBytes: number,
    maxSizeMb: number,
  ): asserts arquivo is Express.Multer.File {
    if (!arquivo) {
      throw new BadRequestException('Arquivo de imagem nao informado');
    }

    if (!arquivo.mimetype || !arquivo.mimetype.startsWith('image/')) {
      throw new BadRequestException('Apenas arquivos de imagem sao permitidos');
    }

    if (arquivo.size > maxSizeBytes) {
      throw new BadRequestException(`Imagem excede o limite de ${maxSizeMb}MB`);
    }
  }

  private async inativarImagemAnterior(imagem: Imagem): Promise<void> {
    imagem.ativo = false;
    await this.imagensRepository.save(imagem);

    const supabaseClient = this.getSupabaseClient();
    await supabaseClient.storage.from(imagem.bucket).remove([imagem.caminho]);
  }

  private toImagemPublica(imagem: Imagem): ImagemPublica {
    const supabaseClient = this.getSupabaseClient();
    const { data } = supabaseClient.storage
      .from(imagem.bucket)
      .getPublicUrl(imagem.caminho);

    return {
      imagemId: imagem.id,
      bucket: imagem.bucket,
      caminho: imagem.caminho,
      urlPublica: data.publicUrl,
      updatedAt: imagem.updated_at,
    };
  }

  private toHomeSliderPublico(registro: SiteSliderImagem): HomeSliderPublico {
    const imagemPublica = this.toImagemPublica(registro.imagem);

    return {
      id: String(registro.id),
      imagemId: imagemPublica.imagemId,
      bucket: imagemPublica.bucket,
      caminho: imagemPublica.caminho,
      urlPublica: imagemPublica.urlPublica,
      imageUrl: imagemPublica.urlPublica,
      alt: registro.texto_alternativo,
      ordem: registro.ordem,
      updatedAt: imagemPublica.updatedAt,
    };
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
}
