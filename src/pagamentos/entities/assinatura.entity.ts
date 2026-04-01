import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('assinaturas')
export class Assinatura {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  usuario_id!: string;

  @Column({ type: 'bigint' })
  plano_id!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: string;

  @Column({ type: 'varchar', length: 50 })
  gateway!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  gateway_cliente_id!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  gateway_assinatura_id!: string | null;

  @Column({ type: 'boolean', default: true })
  renovacao_automatica!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  data_inicio!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  data_fim!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  proxima_cobranca_em!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelado_em!: Date | null;

  @Column({ type: 'text', nullable: true })
  observacoes!: string | null;

  @CreateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  updated_at!: Date;
}
