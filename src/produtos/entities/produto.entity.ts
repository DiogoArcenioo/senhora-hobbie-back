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

@Entity('produtos')
export class Produto {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  criado_por_usuario_id!: string;

  @Column({ type: 'varchar', length: 180 })
  nome!: string;

  @Column({ type: 'varchar', length: 220, unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  descricao!: string | null;

  @Column({ type: 'numeric' })
  preco!: string;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  moeda!: string;

  @ManyToOne(() => Imagem, {
    nullable: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'capa_imagem_id' })
  capa_imagem!: Imagem | null;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;

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
