import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Imagem } from './imagem.entity';

@Entity('site_imagens')
@Unique('uq_site_imagens_chave', ['chave'])
export class SiteImagem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 80 })
  chave!: string;

  @ManyToOne(() => Imagem, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'imagem_id' })
  imagem!: Imagem | null;

  @CreateDateColumn({ type: 'timestamp with time zone', default: () => 'NOW()' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', default: () => 'NOW()' })
  updated_at!: Date;
}
