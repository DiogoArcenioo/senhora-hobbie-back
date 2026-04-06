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

@Entity('site_slider_imagens')
@Unique('uq_site_slider_imagens_ordem', ['ordem'])
export class SiteSliderImagem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'integer', default: 0 })
  ordem!: number;

  @Column({ type: 'varchar', length: 180, nullable: true })
  texto_alternativo!: string | null;

  @ManyToOne(() => Imagem, {
    eager: true,
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'imagem_id' })
  imagem!: Imagem;

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
