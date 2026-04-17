import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('vendas_produtos')
export class VendaProduto {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  pagamento_id!: string;

  @Column({ type: 'bigint' })
  usuario_id!: string;

  @Column({ type: 'bigint' })
  produto_id!: string;

  @Column({ type: 'varchar', length: 180 })
  produto_nome!: string;

  @Column({ type: 'numeric' })
  valor!: string;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  moeda!: string;

  @Column({ type: 'varchar', length: 30, default: 'PENDENTE_ENVIO' })
  status_envio!: string;

  @Column({ type: 'varchar', length: 180 })
  endereco_logradouro!: string;

  @Column({ type: 'varchar', length: 40 })
  endereco_numero!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  endereco_complemento!: string | null;

  @Column({ type: 'varchar', length: 120 })
  endereco_bairro!: string;

  @Column({ type: 'varchar', length: 120 })
  endereco_cidade!: string;

  @Column({ type: 'varchar', length: 2 })
  endereco_estado!: string;

  @Column({ type: 'varchar', length: 20 })
  endereco_cep!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  codigo_rastreio!: string | null;

  @Column({ type: 'text', nullable: true })
  observacoes!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  data_pagamento!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  enviado_em!: Date | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  entregue_em!: Date | null;

  @CreateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  created_at!: Date;

  @UpdateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  updated_at!: Date;
}
