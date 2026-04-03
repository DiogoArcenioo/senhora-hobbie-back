import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Imagem } from '../../imagens/entities/imagem.entity';

@Entity('eventos')
export class Evento {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  criado_por_usuario_id!: string;

  @Column({ type: 'varchar', length: 180 })
  titulo!: string;

  @Column({ type: 'varchar', length: 220, unique: true })
  slug!: string;

  @Column({ type: 'text' })
  descricao_resumo!: string;

  @Column({ type: 'text', nullable: true })
  descricao_detalhada!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  local_nome!: string | null;

  @Column({ type: 'text', nullable: true })
  local_endereco!: string | null;

  @Column({ type: 'timestamp with time zone' })
  inicio_em!: Date;

  @Column({ type: 'timestamp with time zone', nullable: true })
  fim_em!: Date | null;

  @ManyToOne(() => Imagem, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'capa_imagem_id' })
  capa_imagem!: Imagem | null;

  @Column({ type: 'varchar', length: 20, default: 'PUBLICADO' })
  status!: string;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone', default: () => 'NOW()' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', default: () => 'NOW()' })
  updated_at!: Date;
}
