import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Imagem } from '../../imagens/entities/imagem.entity';
import { Produto } from './produto.entity';

@Entity('produto_imagens')
export class ProdutoImagem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  produto_id!: string;

  @Column({ type: 'bigint' })
  imagem_id!: string;

  @ManyToOne(() => Produto, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'produto_id' })
  produto!: Produto;

  @ManyToOne(() => Imagem, { eager: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'imagem_id' })
  imagem!: Imagem;

  @Column({ type: 'integer', default: 0 })
  ordem!: number;

  @Column({ type: 'text', nullable: true })
  legenda!: string | null;

  @Column({ type: 'boolean', default: false })
  destaque!: boolean;

  @CreateDateColumn({
    type: 'timestamp with time zone',
    default: () => 'NOW()',
  })
  created_at!: Date;
}
