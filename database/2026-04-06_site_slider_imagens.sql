-- Tabela de configuracao do slider principal da home (ate 4 imagens)

create table if not exists public.site_slider_imagens (
  id bigserial primary key,
  ordem integer not null default 0 check (ordem >= 0),
  texto_alternativo varchar(180),
  imagem_id bigint not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint uq_site_slider_imagens_ordem unique (ordem),
  constraint fk_site_slider_imagens_imagem
    foreign key (imagem_id)
    references public.imagens (id)
    on delete restrict
);

create index if not exists idx_site_slider_imagens_imagem_id
  on public.site_slider_imagens (imagem_id);
