import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseBootstrapService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        alter table if exists public.usuarios
          add column if not exists tipo varchar(20)
      `);

      await this.dataSource.query(`
        update public.usuarios
        set tipo = 'CLIENTE'
        where tipo is null or btrim(tipo) = ''
      `);

      await this.dataSource.query(`
        alter table if exists public.usuarios
          alter column tipo set default 'CLIENTE'
      `);

      await this.dataSource.query(`
        alter table if exists public.usuarios
          alter column tipo set not null
      `);

      await this.dataSource.query(`
        create table if not exists public.imagens (
          id bigserial primary key,
          usuario_id bigint not null,
          bucket varchar(100) not null default 'user-images',
          caminho text not null,
          nome_original text,
          tipo_mime varchar(100),
          tamanho_bytes integer,
          descricao text,
          publico boolean default false,
          ativo boolean default true,
          created_at timestamp with time zone default now(),
          updated_at timestamp with time zone default now()
        )
      `);

      await this.dataSource.query(`
        create unique index if not exists uq_imagens_bucket_caminho
          on public.imagens (bucket, caminho)
      `);

      await this.dataSource.query(`
        create index if not exists idx_imagens_usuario_id
          on public.imagens (usuario_id)
      `);

      await this.dataSource.query(`
        create table if not exists public.site_imagens (
          id bigserial primary key,
          chave varchar(80) not null,
          imagem_id bigint,
          created_at timestamp with time zone default now(),
          updated_at timestamp with time zone default now(),
          constraint uq_site_imagens_chave unique (chave),
          constraint fk_site_imagens_imagem
            foreign key (imagem_id)
            references public.imagens (id)
            on delete set null
        )
      `);

      await this.dataSource.query(`
        create table if not exists public.eventos (
          id bigserial primary key,
          criado_por_usuario_id bigint not null references public.usuarios(id),
          titulo varchar(180) not null,
          slug varchar(220) not null unique,
          descricao_resumo text not null,
          descricao_detalhada text,
          local_nome varchar(180),
          local_endereco text,
          inicio_em timestamp with time zone not null,
          fim_em timestamp with time zone,
          capa_imagem_id bigint references public.imagens(id) on delete set null,
          status varchar(20) not null default 'PUBLICADO',
          ativo boolean not null default true,
          created_at timestamp with time zone default now(),
          updated_at timestamp with time zone default now()
        )
      `);

      await this.dataSource.query(`
        create index if not exists idx_eventos_inicio_em
          on public.eventos (inicio_em desc)
      `);

      await this.dataSource.query(`
        create index if not exists idx_eventos_status_inicio
          on public.eventos (status, inicio_em desc)
      `);

      await this.dataSource.query(`
        create table if not exists public.evento_imagens (
          id bigserial primary key,
          evento_id bigint not null references public.eventos(id) on delete cascade,
          imagem_id bigint not null references public.imagens(id) on delete restrict,
          ordem integer not null default 0 check (ordem >= 0),
          legenda text,
          destaque boolean not null default false,
          created_at timestamp with time zone default now(),
          unique (evento_id, imagem_id)
        )
      `);

      await this.dataSource.query(`
        create index if not exists idx_evento_imagens_evento_ordem
          on public.evento_imagens (evento_id, ordem, id)
      `);

      this.logger.log(
        'Schema minimo de usuarios, imagens e eventos verificado com sucesso',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao verificar schema inicial: ${message}`);
    }
  }
}
