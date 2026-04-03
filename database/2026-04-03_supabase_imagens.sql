-- Ajustes para suporte a upload de imagens no Supabase + configuracao de imagem da home

alter table if exists public.usuarios
  add column if not exists tipo varchar(20) not null default 'CLIENTE';

update public.usuarios
set tipo = 'CLIENTE'
where tipo is null or btrim(tipo) = '';

-- Tabela de metadados das imagens (espelha os dados salvos no Supabase Storage)
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
);

create unique index if not exists uq_imagens_bucket_caminho
  on public.imagens (bucket, caminho);

create index if not exists idx_imagens_usuario_id
  on public.imagens (usuario_id);

-- Mapeia chaves do site para uma imagem atual (ex: home_destaque)
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
);
