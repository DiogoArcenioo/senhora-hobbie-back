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
import { EventoImagem } from './entities/evento-imagem.entity';
import { Evento } from './entities/evento.entity';

const EVENTO_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const EVENTO_MAX_FILE_SIZE_MB = 25;

type CriarEventoInput = {
  titulo?: string;
  descricao_resumo?: string;
  descricao_detalhada?: string;
  local_nome?: string;
  local_endereco?: string;
  inicio_em?: string;
  fim_em?: string;
  status?: string;
};

type EventoResumoPublico = {
  id: string;
  titulo: string;
  descricaoResumo: string;
  inicioEm: string;
  localNome: string | null;
  localEndereco: string | null;
  capaUrl: string | null;
};

type EventoAlbumPublico = {
  id: string;
  titulo: string;
  descricaoResumo: string;
  descricaoDetalhada: string | null;
  inicioEm: string;
  fimEm: string | null;
  localNome: string | null;
  localEndereco: string | null;
  capaUrl: string | null;
  fotos: {
    id: string;
    url: string;
    legenda: string | null;
    ordem: number;
  }[];
};

@Injectable()
export class EventosService {
  private supabaseClient: SupabaseClient | null = null;
  private readonly storageBucket: string;

  constructor(
    @InjectRepository(Evento)
    private readonly eventosRepository: Repository<Evento>,
    @InjectRepository(EventoImagem)
    private readonly eventoImagensRepository: Repository<EventoImagem>,
    @InjectRepository(Imagem)
    private readonly imagensRepository: Repository<Imagem>,
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly configService: ConfigService,
  ) {
    this.storageBucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET', 'user-images') ??
      'user-images';
  }

  async listarEventosPublicos(): Promise<{
    proximoEvento: EventoResumoPublico | null;
    eventosPassados: EventoResumoPublico[];
  }> {
    const nowIso = new Date().toISOString();

    const proximoEvento = await this.eventosRepository
      .createQueryBuilder('evento')
      .leftJoinAndSelect('evento.capa_imagem', 'capa_imagem')
      .where('evento.ativo = :ativo', { ativo: true })
      .andWhere('evento.status = :status', { status: 'PUBLICADO' })
      .andWhere('evento.inicio_em >= :nowIso', { nowIso })
      .orderBy('evento.inicio_em', 'ASC')
      .getOne();

    const eventosPassados = await this.eventosRepository
      .createQueryBuilder('evento')
      .leftJoinAndSelect('evento.capa_imagem', 'capa_imagem')
      .where('evento.ativo = :ativo', { ativo: true })
      .andWhere('evento.status = :status', { status: 'PUBLICADO' })
      .andWhere('evento.inicio_em < :nowIso', { nowIso })
      .orderBy('evento.inicio_em', 'DESC')
      .getMany();

    return {
      proximoEvento: proximoEvento ? this.toEventoResumoPublico(proximoEvento) : null,
      eventosPassados: eventosPassados.map((evento) =>
        this.toEventoResumoPublico(evento),
      ),
    };
  }

  async obterAlbumPublico(eventoId: string): Promise<EventoAlbumPublico> {
    const evento = await this.eventosRepository.findOne({
      where: {
        id: eventoId,
        ativo: true,
        status: 'PUBLICADO',
      },
    });

    if (!evento) {
      throw new NotFoundException('Evento nao encontrado');
    }

    const fotos = await this.eventoImagensRepository.find({
      where: { evento_id: evento.id },
      order: {
        ordem: 'ASC',
        id: 'ASC',
      },
    });

    return {
      id: evento.id,
      titulo: evento.titulo,
      descricaoResumo: evento.descricao_resumo,
      descricaoDetalhada: evento.descricao_detalhada,
      inicioEm: evento.inicio_em.toISOString(),
      fimEm: evento.fim_em ? evento.fim_em.toISOString() : null,
      localNome: evento.local_nome,
      localEndereco: evento.local_endereco,
      capaUrl: this.buildPublicUrl(evento.capa_imagem),
      fotos: fotos
        .filter((item) => item.imagem?.ativo)
        .map((item) => {
          const url = this.buildPublicUrl(item.imagem);

          return {
            id: item.id,
            url,
            legenda: item.legenda,
            ordem: item.ordem,
          };
        })
        .filter(
          (
            item,
          ): item is {
            id: string;
            url: string;
            legenda: string | null;
            ordem: number;
          } => typeof item.url === 'string' && item.url.length > 0,
        ),
    };
  }

  async criarEventoComImagens(
    usuarioId: string,
    body: CriarEventoInput,
    arquivos: {
      capa?: Express.Multer.File[];
      fotos?: Express.Multer.File[];
    },
  ): Promise<EventoAlbumPublico> {
    await this.validarPermissaoAdmin(usuarioId);

    const titulo = this.requireTextUpper(
      body.titulo,
      'Titulo do evento obrigatorio',
    );
    const descricaoResumo = this.requireTextUpper(
      body.descricao_resumo,
      'Resumo do evento obrigatorio',
    );
    const inicioEm = this.parseDate(body.inicio_em, 'Data de inicio invalida');
    const fimEm = body.fim_em ? this.parseDate(body.fim_em, 'Data de fim invalida') : null;

    if (fimEm && fimEm.getTime() < inicioEm.getTime()) {
      throw new BadRequestException('Data de fim nao pode ser anterior ao inicio');
    }

    const capaArquivo = arquivos.capa?.[0];

    if (!capaArquivo) {
      throw new BadRequestException('Foto de capa obrigatoria');
    }

    const fotosArquivos = arquivos.fotos ?? [];
    this.validarArquivos(capaArquivo, fotosArquivos);

    const slug = await this.generateUniqueSlug(titulo);
    const status = this.normalizeStatus(body.status);

    const capaImagem = await this.uploadArquivoParaImagem({
      arquivo: capaArquivo,
      usuarioId,
      pasta: `eventos/capas/${slug}`,
      descricao: `Capa do evento ${titulo}`,
    });

    const evento = this.eventosRepository.create({
      criado_por_usuario_id: usuarioId,
      titulo,
      slug,
      descricao_resumo: descricaoResumo,
      descricao_detalhada: this.optionalTextUpper(body.descricao_detalhada),
      local_nome: this.optionalTextUpper(body.local_nome),
      local_endereco: this.optionalTextUpper(body.local_endereco),
      inicio_em: inicioEm,
      fim_em: fimEm,
      capa_imagem: capaImagem,
      status,
      ativo: true,
    });

    const eventoSalvo = await this.eventosRepository.save(evento);

    let ordem = 0;
    for (const arquivo of fotosArquivos) {
      const imagem = await this.uploadArquivoParaImagem({
        arquivo,
        usuarioId,
        pasta: `eventos/albuns/${eventoSalvo.slug}`,
        descricao: `Foto do album do evento ${eventoSalvo.titulo}`,
      });

      const item = this.eventoImagensRepository.create({
        evento_id: eventoSalvo.id,
        imagem_id: imagem.id,
        imagem,
        ordem,
        legenda: null,
        destaque: ordem === 0,
      });

      await this.eventoImagensRepository.save(item);
      ordem += 1;
    }

    return this.obterAlbumPublico(eventoSalvo.id);
  }

  private async validarPermissaoAdmin(usuarioId: string): Promise<void> {
    const usuario = await this.usuariosRepository.findOne({
      where: { id: usuarioId },
    });

    if (!usuario || !usuario.ativo || usuario.tipo !== 'ADM') {
      throw new ForbiddenException('Somente administradores podem cadastrar eventos');
    }
  }

  private toEventoResumoPublico(evento: Evento): EventoResumoPublico {
    return {
      id: evento.id,
      titulo: evento.titulo,
      descricaoResumo: evento.descricao_resumo,
      inicioEm: evento.inicio_em.toISOString(),
      localNome: evento.local_nome,
      localEndereco: evento.local_endereco,
      capaUrl: this.buildPublicUrl(evento.capa_imagem),
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

  private async uploadArquivoParaImagem(params: {
    arquivo: Express.Multer.File;
    usuarioId: string;
    pasta: string;
    descricao: string;
  }): Promise<Imagem> {
    const nomeArquivoSeguro = this.sanitizeFilename(params.arquivo.originalname || 'imagem');
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

  private validarArquivos(
    capaArquivo: Express.Multer.File,
    fotosArquivos: Express.Multer.File[],
  ): void {
    const arquivos = [capaArquivo, ...fotosArquivos];

    const arquivosNaoImagem = arquivos
      .filter(
        (arquivo) =>
          !arquivo.mimetype || !arquivo.mimetype.startsWith('image/'),
      )
      .map((arquivo) => this.resolveNomeArquivo(arquivo));

    if (arquivosNaoImagem.length > 0) {
      throw new BadRequestException(
        `Apenas arquivos de imagem sao permitidos. Invalidos: ${arquivosNaoImagem.join(
          ', ',
        )}`,
      );
    }

    const arquivosAcimaDoLimite = arquivos
      .filter((arquivo) => arquivo.size > EVENTO_MAX_FILE_SIZE_BYTES)
      .map(
        (arquivo) =>
          `${this.resolveNomeArquivo(arquivo)} (${this.formatBytes(
            arquivo.size,
          )})`,
      );

    if (arquivosAcimaDoLimite.length > 0) {
      throw new BadRequestException(
        `Arquivos acima do limite de ${EVENTO_MAX_FILE_SIZE_MB}MB: ${arquivosAcimaDoLimite.join(
          ', ',
        )}`,
      );
    }
  }

  private optionalText(value?: string): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private requireText(value: string | undefined, message: string): string {
    const normalized = this.optionalText(value);

    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private optionalTextUpper(value?: string): string | null {
    const normalized = this.optionalText(value);

    if (!normalized) {
      return null;
    }

    return normalized.toUpperCase();
  }

  private requireTextUpper(value: string | undefined, message: string): string {
    const normalized = this.requireText(value, message);
    return normalized.toUpperCase();
  }

  private parseDate(value: string | undefined, message: string): Date {
    if (!value || value.trim().length === 0) {
      throw new BadRequestException(message);
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(message);
    }

    return date;
  }

  private normalizeStatus(status?: string): string {
    if (!status) {
      return 'PUBLICADO';
    }

    const normalized = status.trim().toUpperCase();

    if (normalized !== 'RASCUNHO' && normalized !== 'PUBLICADO' && normalized !== 'CANCELADO') {
      throw new BadRequestException('Status do evento invalido');
    }

    return normalized;
  }

  private sanitizeFilename(filename: string): string {
    const trimmed = filename.trim().toLowerCase();
    const normalized = trimmed.replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');

    if (!normalized) {
      return 'imagem.jpg';
    }

    return normalized;
  }

  private async generateUniqueSlug(titulo: string): Promise<string> {
    const base =
      titulo
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'evento';

    let slug = base;
    let suffix = 0;

    while (true) {
      const existente = await this.eventosRepository.findOne({
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

  private resolveNomeArquivo(arquivo: Express.Multer.File): string {
    const original = arquivo.originalname?.trim();

    if (original && original.length > 0) {
      return original;
    }

    return 'arquivo_sem_nome';
  }

  private formatBytes(bytes: number): string {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)}MB`;
  }
}
