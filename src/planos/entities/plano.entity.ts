import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('planos')
export class Plano {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  nome!: string;

  @Column({ type: 'text', nullable: true })
  descricao!: string | null;

  @Column({ type: 'varchar', length: 60 })
  tipo!: string;

  @Column({ type: 'numeric' })
  valor!: string;

  @Column({ type: 'varchar', length: 12 })
  moeda!: string;

  @Column({ type: 'varchar', length: 60 })
  periodicidade_cobranca!: string;

  @Column({ type: 'integer', nullable: true })
  duracao_dias!: number | null;

  @Column({ type: 'integer', nullable: true })
  duracao_meses!: number | null;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;

  @CreateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'NOW()' })
  updated_at!: Date;
}
