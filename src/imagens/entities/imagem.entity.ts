import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('imagens')
export class Imagem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  usuario_id!: string;

  @Column({ type: 'varchar', length: 100, default: 'user-images' })
  bucket!: string;

  @Column({ type: 'text' })
  caminho!: string;

  @Column({ type: 'text', nullable: true })
  nome_original!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  tipo_mime!: string | null;

  @Column({ type: 'integer', nullable: true })
  tamanho_bytes!: number | null;

  @Column({ type: 'text', nullable: true })
  descricao!: string | null;

  @Column({ type: 'boolean', default: false })
  publico!: boolean;

  @Column({ type: 'boolean', default: true })
  ativo!: boolean;

  @CreateDateColumn({ type: 'timestamp with time zone', default: () => 'NOW()' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone', default: () => 'NOW()' })
  updated_at!: Date;
}
