import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('logs_pagamentos')
export class LogPagamento {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', nullable: true })
  usuario_id!: string | null;

  @Column({ type: 'bigint', nullable: true })
  assinatura_id!: string | null;

  @Column({ type: 'bigint', nullable: true })
  pagamento_id!: string | null;

  @Column({ type: 'bigint', nullable: true })
  webhook_id!: string | null;

  @Column({ type: 'varchar', length: 20 })
  nivel!: string;

  @Column({ type: 'varchar', length: 80 })
  evento!: string;

  @Column({ type: 'text' })
  descricao!: string;

  @Column({ type: 'jsonb', nullable: true })
  detalhes!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  created_at!: Date;
}
