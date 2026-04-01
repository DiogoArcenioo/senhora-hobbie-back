import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pagamentos')
export class Pagamento {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', nullable: true })
  assinatura_id!: string | null;

  @Column({ type: 'bigint' })
  usuario_id!: string;

  @Column({ type: 'bigint', nullable: true })
  plano_id!: string | null;

  @Column({ type: 'varchar', length: 50 })
  gateway!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  gateway_pagamento_id!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  gateway_preferencia_id!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  gateway_checkout_id!: string | null;

  @Column({ type: 'varchar', length: 50 })
  status!: string;

  @Column({ type: 'numeric' })
  valor!: string;

  @Column({ type: 'varchar', length: 10 })
  moeda!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  forma_pagamento!: string | null;

  @Column({ type: 'integer', nullable: true })
  parcelas!: number | null;

  @Column({ type: 'text', nullable: true })
  descricao!: string | null;

  @Column({ type: 'text', nullable: true })
  motivo_recusa!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  detalhes_gateway!: Record<string, unknown> | null;

  @Column({ type: 'timestamp', nullable: true })
  data_pagamento!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  data_vencimento!: Date | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  updated_at!: Date;
}
