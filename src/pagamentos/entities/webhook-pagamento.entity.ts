import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('webhooks_pagamentos')
export class WebhookPagamento {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  gateway!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  tipo_evento!: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  acao!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  webhook_id_externo!: string | null;

  @Column({ type: 'bigint', nullable: true })
  assinatura_id!: string | null;

  @Column({ type: 'bigint', nullable: true })
  pagamento_id!: string | null;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  headers!: Record<string, unknown> | null;

  @Column({ type: 'boolean', nullable: true })
  assinatura_valida!: boolean | null;

  @Column({ type: 'boolean', default: false })
  processado!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  data_processamento!: Date | null;

  @Column({ type: 'text', nullable: true })
  erro_processamento!: string | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  created_at!: Date;
}
