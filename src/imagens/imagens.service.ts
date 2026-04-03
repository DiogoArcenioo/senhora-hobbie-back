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

type ImagemPublica = {
  imagemId: string;
  bucket: string;
  caminho: string;
  urlPublica: string;
  updatedAt: Date;
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
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly configService: ConfigService,
  ) {
    this.storageBucket =
      this.configService.get<string>('SUPABASE_STORAGE_BUCKET', 'user-images') ??
      'user-images';
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
    this.validarArquivo(arquivo);

    const nomeArquivoSeguro = this.sanitizeFilename(arquivo.originalname || 'imagem');
    const caminho = `site/home-destaque/${Date.now()}-${nomeArquivoSeguro}`;

    const supabaseClient = this.getSupabaseClient();
    const { error: uploadError } = await supabaseClient.storage
      .from(this.storageBucket)
      .upload(caminho, arquivo.buffer, {
        contentType: arquivo.mimetype,
        upsert: false,
      });

    if (uploadError) {
      throw new InternalServerErrorException(
        `Falha no upload para Supabase: ${uploadError.message}`,
      );
    }

    const registroAnterior = await this.siteImagensRepository.findOne({
      where: { chave: 'home_destaque' },
    });

    if (registroAnterior?.imagem) {
      await this.inativarImagemAnterior(registroAnterior.imagem);
    }

    const novaImagem = this.imagensRepository.create({
      usuario_id: usuarioId,
      bucket: this.storageBucket,
      caminho,
      nome_original: arquivo.originalname || null,
      tipo_mime: arquivo.mimetype || null,
      tamanho_bytes: arquivo.size,
      descricao: 'Imagem de destaque da home',
      publico: true,
      ativo: true,
    });

    const imagemSalva = await this.imagensRepository.save(novaImagem);

    const configuracao = registroAnterior
      ? this.siteImagensRepository.merge(registroAnterior, { imagem: imagemSalva })
      : this.siteImagensRepository.create({
          chave: 'home_destaque',
          imagem: imagemSalva,
        });

    await this.siteImagensRepository.save(configuracao);

    return this.toImagemPublica(imagemSalva);
  }

  private async validarPermissaoAdmin(usuarioId: string): Promise<void> {
    const usuario = await this.usuariosRepository.findOne({
      where: { id: usuarioId },
    });

    if (!usuario || !usuario.ativo || usuario.tipo !== 'ADM') {
      throw new ForbiddenException('Somente administradores podem editar esta imagem');
    }
  }

  private validarArquivo(arquivo: Express.Multer.File | undefined): asserts arquivo is Express.Multer.File {
    if (!arquivo) {
      throw new BadRequestException('Arquivo de imagem nao informado');
    }

    if (!arquivo.mimetype || !arquivo.mimetype.startsWith('image/')) {
      throw new BadRequestException('Apenas arquivos de imagem sao permitidos');
    }

    const maxSize = 10 * 1024 * 1024;

    if (arquivo.size > maxSize) {
      throw new BadRequestException('Imagem excede o limite de 10MB');
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
    const normalized = trimmed.replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');

    if (!normalized) {
      return 'imagem.jpg';
    }

    return normalized;
  }
}
